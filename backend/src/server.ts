import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import rateLimit from 'express-rate-limit';

import { logger } from '@/utils/logger';
import { errorHandler } from '@/middleware/errorHandler';
import { authMiddleware } from '@/middleware/auth';
import { requestLogger } from '@/middleware/requestLogger';
import { setupSwagger } from '@/utils/swagger';
import { scheduledTasksService } from '@/services/ScheduledTasksService';

// Route imports
import documentRoutes from '@/controllers/documents';
import articleRoutes from '@/controllers/articles';
import aiRoutes from '@/controllers/ai';
import mediaRoutes from '@/controllers/media';
import authRoutes from '@/controllers/auth';
import publicRoutes from '@/controllers/public';
import auditRoutes from '@/controllers/audit';
import scrapingRoutes, { cleanupOrchestrator } from '@/controllers/scraping-v2'; // ARQUITECTURA MODULAR V2
import adminRoutes from '@/controllers/admin'; // FUNCIÓN TEMPORAL
import { sseController } from '@/controllers/sse';
import healthRoutes from '@/controllers/health';
import seoRoutes from '@/routes/seo';
import storageRoutes from '@/routes/storage';

// Load environment variables
config();

const app = express();
const port = process.env.PORT || 3001;

// Initialize Prisma and Redis
const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// Initialize Redis only if REDIS_URL is provided
let redis: any = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err: any) => {
    logger.warn('Redis connection error (continuing without Redis)', { error: err.message });
  });
} else {
  logger.info('Redis not configured (REDIS_URL not set) - continuing without Redis');
}

// Rate limiting - Very permissive for development
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'), // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10000'), // 10000 requests per minute (very permissive)
  message: {
    error: 'Too many requests from this IP, please try again later',
    retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000') / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for local development
  skip: (req) => {
    return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  }
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
  credentials: true,
}));

// Morgan con filtro para evitar logs ruidosos
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
  skip: (req) => {
    // Filtrar rutas ruidosas que generan logs innecesarios
    const noisyPaths = ['/images/', '/favicon.ico', '/api/health', '/api/events/stream'];
    return noisyPaths.some(path => req.url.startsWith(path));
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);
app.use(limiter);

// Swagger documentation
setupSwagger(app);

// Health check endpoint (no auth required)
app.use('/api/health', healthRoutes);

// Public routes (no auth required)
app.use('/api/public', publicRoutes);

// SEO routes (no auth required)
app.use('/api/seo', seoRoutes);

// Storage routes (no auth required - public images)
app.use('/api/storage', storageRoutes);

// Auth routes (no auth required for login/register)
app.use('/api/auth', authRoutes);

// SSE endpoint with query param auth support (for EventSource compatibility)
app.get('/api/events/stream', (req, res, next) => {
  // Try to get token from query params first (for EventSource)
  const tokenFromQuery = req.query.token as string;
  
  if (tokenFromQuery) {
    // Set the Authorization header for authMiddleware
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }
  
  // Now use the regular auth middleware
  authMiddleware(req, res, (err) => {
    if (err) {
      return next(err);
    }
    // If auth passes, connect to SSE
    sseController.connect(req, res);
  });
});

// Protected routes
app.use('/api/documents', authMiddleware, documentRoutes);
app.use('/api/articles', authMiddleware, articleRoutes);
app.use('/api/ai', authMiddleware, aiRoutes);
app.use('/api/media', authMiddleware, mediaRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/scraping/v2', authMiddleware, scrapingRoutes); // ARQUITECTURA MODULAR V2
app.use('/api/admin', authMiddleware, adminRoutes); // FUNCIÓN TEMPORAL - Solo para desarrollo

// Static files serving
app.use('/uploads', express.static(process.env.UPLOAD_DIR || './uploads'));

// Servir documentos descargados (DOCX, RTF) desde storage/documents
app.use('/api/storage/documents', express.static(path.join(__dirname, '../storage/documents')));

// Image files are now served via programmatic endpoint in storage.ts
// for better error handling, logging, and cache control

// Servir frontend estático en producción
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.join(__dirname, 'public');

  app.use(express.static(frontendPath, {
    maxAge: '1y',
    etag: true,
    index: false // Evitar servir index.html automáticamente
  }));

  // Catch-all route para SPA (debe ser ÚLTIMA ruta, después de todas las API routes)
  app.get('*', (req, res) => {
    const indexPath = path.join(frontendPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Frontend not found. Run: npm run build' });
    }
  });
}

// Servir placeholder SVG para evitar 404s infinitos
app.get('/images/placeholder-article.jpg', (req, res) => {
  const svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="400" fill="#f3f4f6"/>
    <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">
      Imagen no disponible
    </text>
  </svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache 1 año
  res.send(svg);
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Editorial Jurídico API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      documentation: '/api-docs',
      auth: '/api/auth',
      public: '/api/public'
    }
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method,
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');

  // Stop scheduled tasks
  scheduledTasksService.stop();

  // Cleanup scraping orchestrator
  await cleanupOrchestrator();

  // Close database connections
  await prisma.$disconnect();
  if (redis) {
    await redis.quit();
  }

  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');

  // Stop scheduled tasks
  scheduledTasksService.stop();

  // Cleanup scraping orchestrator
  await cleanupOrchestrator();

  // Close database connections
  await prisma.$disconnect();
  if (redis) {
    await redis.quit();
  }

  process.exit(0);
});

// Start server
const server = app.listen(port, () => {
  logger.info(`🚀 Editorial Jurídico API running on port ${port}`);
  logger.info(`📚 API Documentation: http://localhost:${port}/api-docs`);
  logger.info(`🔍 Environment: ${process.env.NODE_ENV || 'development'}`);

  // ✅ Start scheduled tasks
  scheduledTasksService.start();
});

// Export for testing
export { app, prisma, redis };
export default server;