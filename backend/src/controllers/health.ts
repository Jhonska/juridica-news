import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { logger } from '@/utils/logger';

const router = Router();
const prisma = new PrismaClient();

// Initialize Redis only if REDIS_URL is provided
let redis: any = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err: any) => {
    logger.warn('Redis connection error in health check', { error: err.message });
  });
}

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  services: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    elasticsearch: 'ok' | 'error';
    ai_services: 'ok' | 'degraded' | 'error';
  };
  version?: string;
}

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [System]
 *     responses:
 *       200:
 *         description: System is healthy
 *       503:
 *         description: System is unhealthy
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const health: HealthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: 'ok',
      redis: 'ok',
      elasticsearch: 'ok',
      ai_services: 'ok',
    },
    version: process.env.npm_package_version || '1.0.0',
  };

  // Check database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    health.services.database = 'error';
    health.status = 'down';
    logger.error('Database health check failed', { error });
  }

  // Check Redis connection (only if configured)
  if (redis) {
    try {
      await redis.ping();
    } catch (error) {
      health.services.redis = 'error';
      health.status = 'degraded';
      logger.error('Redis health check failed', { error });
    }
  } else {
    health.services.redis = 'unavailable';
  }

  // Check Elasticsearch (if configured)
  if (process.env.ELASTICSEARCH_URL) {
    try {
      // Simple fetch to check if Elasticsearch is responding
      const esResponse = await fetch(`${process.env.ELASTICSEARCH_URL}/_cluster/health`, {
        method: 'GET',
        timeout: 2000,
      });
      
      if (!esResponse.ok) {
        health.services.elasticsearch = 'error';
        if (health.status === 'ok') health.status = 'degraded';
      }
    } catch (error) {
      health.services.elasticsearch = 'error';
      if (health.status === 'ok') health.status = 'degraded';
      logger.error('Elasticsearch health check failed', { error });
    }
  }

  // Check AI services availability (basic check)
  try {
    const aiChecks = [];
    
    if (process.env.OPENAI_API_KEY) {
      aiChecks.push(checkOpenAI());
    }
    
    if (process.env.ANTHROPIC_API_KEY) {
      aiChecks.push(checkAnthropic());
    }

    const aiResults = await Promise.allSettled(aiChecks);
    const failedAI = aiResults.filter(result => result.status === 'rejected').length;
    
    if (failedAI === aiChecks.length && aiChecks.length > 0) {
      health.services.ai_services = 'error';
      if (health.status === 'ok') health.status = 'degraded';
    } else if (failedAI > 0) {
      health.services.ai_services = 'degraded';
      if (health.status === 'ok') health.status = 'degraded';
    }
  } catch (error) {
    health.services.ai_services = 'error';
    logger.error('AI services health check failed', { error });
  }

  const responseTime = Date.now() - startTime;
  const statusCode = health.status === 'down' ? 503 : 200;

  // Log health check
  logger.info('Health check completed', {
    status: health.status,
    responseTime: `${responseTime}ms`,
    services: health.services,
  });

  res.status(statusCode).json({
    ...health,
    responseTime: `${responseTime}ms`,
  });
});

/**
 * @swagger
 * /api/health/detailed:
 *   get:
 *     summary: Detailed health check with performance metrics
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Detailed system status
 */
router.get('/detailed', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const [memoryUsage, databaseStats, systemLoad] = await Promise.allSettled([
      Promise.resolve(process.memoryUsage()),
      getDatabaseStats(),
      Promise.resolve(process.loadavg()),
    ]);

    const detailed = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: memoryUsage.status === 'fulfilled' ? {
          rss: `${Math.round(memoryUsage.value.rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memoryUsage.value.heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memoryUsage.value.heapUsed / 1024 / 1024)}MB`,
          external: `${Math.round(memoryUsage.value.external / 1024 / 1024)}MB`,
        } : null,
        loadAverage: systemLoad.status === 'fulfilled' ? systemLoad.value : null,
      },
      database: databaseStats.status === 'fulfilled' ? databaseStats.value : null,
      responseTime: `${Date.now() - startTime}ms`,
    };

    res.json(detailed);

  } catch (error) {
    logger.error('Detailed health check error', { error });
    res.status(500).json({
      error: 'Health check service error',
      timestamp: new Date().toISOString(),
    });
  }
});

// Helper functions
async function checkOpenAI(): Promise<boolean> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function checkAnthropic(): Promise<boolean> {
  try {
    // Simple check - Anthropic doesn't have a models endpoint like OpenAI
    // This is a basic connectivity check
    const response = await fetch('https://api.anthropic.com/', {
      method: 'GET',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
      },
      signal: AbortSignal.timeout(3000),
    });
    
    // Even a 404 or 405 means the service is reachable
    return response.status !== 0;
  } catch (error) {
    return false;
  }
}

async function getDatabaseStats() {
  try {
    const [userCount, documentCount, articleCount] = await Promise.all([
      prisma.user.count(),
      prisma.document.count(),
      prisma.article.count(),
    ]);

    return {
      connected: true,
      counts: {
        users: userCount,
        documents: documentCount,
        articles: articleCount,
      },
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default router;