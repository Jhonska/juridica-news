
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { validateRequest } from '@/middleware/validation';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();
const prisma = new PrismaClient();

// Helper: Limpiar directorio de archivos físicos
async function cleanStorageDirectory(dirPath: string): Promise<{ deleted: number; errors: string[] }> {
  const result = { deleted: 0, errors: [] as string[] };

  try {
    if (!fs.existsSync(dirPath)) {
      logger.info(`📁 Directorio no existe, omitiendo: ${dirPath}`);
      return result;
    }

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      // Ignorar archivos ocultos y README
      if (file.startsWith('.') || file === 'README.md') continue;

      const filePath = path.join(dirPath, file);

      try {
        const stat = fs.statSync(filePath);

        if (stat.isFile()) {
          fs.unlinkSync(filePath);
          result.deleted++;
          logger.debug(`🗑️ Archivo eliminado: ${file}`);
        }
      } catch (fileError) {
        const errorMsg = `Error eliminando ${file}: ${fileError instanceof Error ? fileError.message : 'Unknown'}`;
        result.errors.push(errorMsg);
        logger.warn(errorMsg);
      }
    }

    logger.info(`✅ Limpieza de ${dirPath}: ${result.deleted} archivos eliminados`);
  } catch (error) {
    const errorMsg = `Error limpiando directorio ${dirPath}: ${error instanceof Error ? error.message : 'Unknown'}`;
    result.errors.push(errorMsg);
    logger.error(errorMsg);
  }

  return result;
}

// Validation schema for reset confirmation
const resetConfirmationSchema = z.object({
  confirmation: z.literal('RESET'),
  reason: z.string().min(10).max(500),
});

/**
 * @swagger
 * /api/admin/reset:
 *   post:
 *     summary: Reset system data (TEMPORAL - FUNCIÓN DE DESARROLLO)
 *     description: Elimina todos los documentos, artículos y datos relacionados. SOLO PARA DESARROLLO.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               confirmation:
 *                 type: string
 *                 enum: [RESET]
 *                 description: Debe ser exactamente "RESET" para confirmar
 *               reason:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 500
 *                 description: Razón del reset del sistema
 *             required:
 *               - confirmation
 *               - reason
 *     responses:
 *       200:
 *         description: Sistema reseteado exitosamente
 *       403:
 *         description: Sin permisos suficientes
 *       400:
 *         description: Confirmación inválida
 */
router.post('/reset', validateRequest(resetConfirmationSchema), async (req: Request, res: Response) => {
  try {
    // FUNCIÓN TEMPORAL - Solo para desarrollo/testing
    // Verificar que el usuario sea administrador
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Only administrators can reset the system'
      });
    }

    const { confirmation, reason } = req.body;
    
    // Triple verificación de seguridad
    if (confirmation !== 'RESET') {
      return res.status(400).json({
        error: 'Invalid confirmation',
        message: 'Must provide exact confirmation string "RESET"'
      });
    }

    logger.warn('🚨 SYSTEM RESET INITIATED', {
      userId: req.user.id,
      userEmail: req.user.email,
      reason,
      timestamp: new Date().toISOString(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || ''
    });

    const startTime = Date.now();
    const resetStats = {
      documentsDeleted: 0,
      articlesDeleted: 0,
      articleVersionsDeleted: 0,
      mediaAssetsDeleted: 0,
      auditLogsDeleted: 0,
      extractionHistoryDeleted: 0,
      refreshTokensDeleted: 0,
      generatedImagesDeleted: 0,
      physicalDocumentsDeleted: 0,
      physicalImagesDeleted: 0,
    };

    // Ejecutar transacción para reset completo
    // ORDEN CRÍTICO: eliminar primero dependientes, luego principales
    await prisma.$transaction(async (tx) => {
      // 1. Contar y eliminar tokens de refresco (excepto del usuario actual)
      // FUNCIÓN TEMPORAL - Mantener sesión activa del admin que ejecuta
      const refreshTokenCount = await tx.refreshToken.count({
        where: { userId: { not: req.user.id } }
      });
      await tx.refreshToken.deleteMany({
        where: { userId: { not: req.user.id } }
      });
      resetStats.refreshTokensDeleted = refreshTokenCount;

      // 2. Contar y eliminar logs de auditoría (excepto este reset)
      // FUNCIÓN TEMPORAL - Limpiar primero para evitar referencias
      const auditLogCount = await tx.auditLog.count();
      await tx.auditLog.deleteMany();
      resetStats.auditLogsDeleted = auditLogCount;

      // 3. Contar y eliminar historial de extracciones
      // FUNCIÓN TEMPORAL - Limpiar references a usuarios
      const extractionHistoryCount = await tx.extractionHistory.count();
      await tx.extractionHistory.deleteMany();
      resetStats.extractionHistoryDeleted = extractionHistoryCount;

      // 4. Contar y eliminar versiones de artículos (dependen de artículos)
      // FUNCIÓN TEMPORAL - Eliminar antes que artículos
      const articleVersionCount = await tx.articleVersion.count();
      await tx.articleVersion.deleteMany();
      resetStats.articleVersionsDeleted = articleVersionCount;

      // 5. Contar y eliminar assets multimedia (pueden depender de artículos)
      // FUNCIÓN TEMPORAL - Limpieza de archivos multimedia
      const mediaAssetCount = await tx.mediaAsset.count();
      await tx.mediaAsset.deleteMany();
      resetStats.mediaAssetsDeleted = mediaAssetCount;

      // 6. Contar y eliminar artículos (pueden tener referencias de documentos)
      // FUNCIÓN TEMPORAL - Eliminar antes que documentos
      const articleCount = await tx.article.count();
      await tx.article.deleteMany();
      resetStats.articlesDeleted = articleCount;

      // 6.5. Contar y eliminar imágenes generadas (tabla GeneratedImage)
      // FUNCIÓN TEMPORAL - Limpiar registros de imágenes AI
      const generatedImageCount = await tx.generatedImage.count();
      await tx.generatedImage.deleteMany();
      resetStats.generatedImagesDeleted = generatedImageCount;

      // 7. Actualizar documentos para remover referencias FK antes de eliminar
      // FUNCIÓN TEMPORAL - Limpiar foreign keys manualmente 
      await tx.document.updateMany({
        data: {
          curatorId: null,
          userId: null
        }
      });

      // 8. Contar y eliminar documentos (ahora sin restricciones FK)
      // FUNCIÓN TEMPORAL - Limpieza completa de documentos
      const documentCount = await tx.document.count();
      await tx.document.deleteMany();
      resetStats.documentsDeleted = documentCount;

      // 9. Crear log de auditoría del reset
      // FUNCIÓN TEMPORAL - Registrar la operación de reset
      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'SYSTEM_RESET', // FUNCIÓN TEMPORAL
          description: `System reset executed: ${reason}`,
          ipAddress: req.ip || null,
          userAgent: req.get('User-Agent') || '',
          timestamp: new Date(),
        }
      });
    });

    // 10. Limpiar archivos físicos DESPUÉS de la transacción exitosa
    // FUNCIÓN TEMPORAL - Eliminar documentos DOCX/RTF descargados
    const storageDir = path.resolve(__dirname, '../../storage');
    const documentsDir = path.join(storageDir, 'documents');
    const imagesDir = path.join(storageDir, 'images');

    logger.info('🗂️ Iniciando limpieza de archivos físicos...');

    const documentsCleanup = await cleanStorageDirectory(documentsDir);
    resetStats.physicalDocumentsDeleted = documentsCleanup.deleted;

    const imagesCleanup = await cleanStorageDirectory(imagesDir);
    resetStats.physicalImagesDeleted = imagesCleanup.deleted;

    if (documentsCleanup.errors.length > 0 || imagesCleanup.errors.length > 0) {
      logger.warn('⚠️ Algunos archivos no pudieron ser eliminados:', {
        documentsErrors: documentsCleanup.errors,
        imagesErrors: imagesCleanup.errors
      });
    }

    const executionTime = (Date.now() - startTime) / 1000;

    logger.warn('✅ SYSTEM RESET COMPLETED', {
      userId: req.user.id,
      resetStats,
      executionTime,
      reason
    });

    return res.json({
      success: true,
      message: 'System reset completed successfully',
      statistics: resetStats,
      executionTime: `${executionTime}s`,
      timestamp: new Date().toISOString(),
      // FUNCIÓN TEMPORAL - Información de desarrollo
      warning: 'This is a temporary development function'
    });

  } catch (error) {
    logger.error('❌ SYSTEM RESET FAILED', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      userId: req.user.id 
    });

    return res.status(500).json({
      error: 'System reset failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      // FUNCIÓN TEMPORAL - No exponer detalles en producción
      details: process.env.NODE_ENV === 'development' ? error : undefined
    });
  }
});

/**
 * @swagger
 * /api/admin/system-info:
 *   get:
 *     summary: Get system information and statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System information
 *       403:
 *         description: Access denied
 */
router.get('/system-info', async (req: Request, res: Response) => {
  try {
    // Verificar permisos de administrador
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Only administrators can view system information'
      });
    }

    // FUNCIÓN TEMPORAL - Obtener estadísticas actuales del sistema
    const [
      totalDocuments,
      totalArticles,
      totalVersions,
      totalMediaAssets,
      totalAuditLogs,
      totalExtractions,
      totalUsers
    ] = await Promise.all([
      prisma.document.count(),
      prisma.article.count(),
      prisma.articleVersion.count(),
      prisma.mediaAsset.count(),
      prisma.auditLog.count(),
      prisma.extractionHistory.count(),
      prisma.user.count()
    ]);

    const systemInfo = {
      documents: totalDocuments,
      articles: totalArticles,
      articleVersions: totalVersions,
      mediaAssets: totalMediaAssets,
      auditLogs: totalAuditLogs,
      extractions: totalExtractions,
      users: totalUsers,
      timestamp: new Date().toISOString(),
      // FUNCIÓN TEMPORAL - Información de desarrollo
      environment: process.env.NODE_ENV || 'development',
      resetAvailable: true // Indica que la función de reset está disponible
    };

    return res.json({
      success: true,
      data: systemInfo
    });

  } catch (error) {
    logger.error('Error retrieving system info', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: req.user.id
    });

    return res.status(500).json({
      error: 'Failed to retrieve system information',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;