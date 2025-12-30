/**
 * Gestor de colas para el sistema de scraping
 * Sistema Editorial Jurídico Supervisado
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@/utils/logger';
import { ScrapingOrchestrator } from './ScrapingOrchestrator';
import { ExtractionParameters, ScrapingJob, JobStatus } from '@/scrapers/base/types';
import { sseController } from '@/controllers/sse';

interface QueueJobData {
  sourceId: string;
  parameters: ExtractionParameters;
  userId?: string;
  jobId: string;
}

export class QueueManager {
  private redis: Redis | null;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private orchestrator: ScrapingOrchestrator;
  private isInitialized = false;
  private redisAvailable = false;

  constructor(orchestrator: ScrapingOrchestrator, redisUrl?: string) {
    this.orchestrator = orchestrator;

    const redisUrl_ = redisUrl || process.env.REDIS_URL;
    if (redisUrl_) {
      this.redis = new Redis(redisUrl_);
      this.setupRedisEventHandlers();
    } else {
      this.redis = null;
      logger.warn('⚠️ Redis not configured (REDIS_URL not set) - Queue system disabled');
    }
  }

  /**
   * Inicializar el gestor de colas
   */
  async initialize(sources: string[]): Promise<void> {
    if (this.isInitialized) {
      logger.warn('⚠️ QueueManager ya está inicializado');
      return;
    }

    // Si Redis no está disponible, simplemente marcar como inicializado y retornar
    if (!this.redis) {
      logger.warn('⚠️ Redis no está disponible - Queue system disabled');
      this.isInitialized = true;
      return;
    }

    try {
      // Verificar conexión Redis
      await this.redis.ping();
      logger.info('✅ Conexión Redis establecida');

      // Crear colas y workers para cada fuente
      for (const sourceId of sources) {
        await this.createQueueForSource(sourceId);
      }

      this.isInitialized = true;
      logger.info(`🚀 QueueManager inicializado con ${sources.length} fuentes`);

    } catch (error) {
      logger.error('❌ Error inicializando QueueManager:', error);
      // No throw - solo log, permite que la app continúe sin colas
      this.isInitialized = true;
    }
  }

  /**
   * Crear cola y worker para una fuente específica
   */
  private async createQueueForSource(sourceId: string): Promise<void> {
    const queueName = `scraping:${sourceId}`;
    
    // Crear cola
    const queue = new Queue(queueName, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 50, // Mantener últimos 50 trabajos completados
        removeOnFail: 100,    // Mantener últimos 100 trabajos fallidos
        attempts: 3,          // 3 intentos por defecto
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    });

    // Crear worker
    const worker = new Worker(
      queueName,
      async (job: Job<QueueJobData>) => {
        return await this.processScrapingJob(job);
      },
      {
        connection: this.redis,
        concurrency: 1, // Un trabajo a la vez por fuente
        maxStalledCount: 1,
        stalledInterval: 30000
      }
    );

    // Crear eventos de cola
    const queueEvents = new QueueEvents(queueName, {
      connection: this.redis
    });

    // Configurar listeners de eventos
    this.setupWorkerListeners(worker, sourceId);
    this.setupQueueListeners(queueEvents, sourceId);

    // Guardar referencias
    this.queues.set(sourceId, queue);
    this.workers.set(sourceId, worker);
    this.queueEvents.set(sourceId, queueEvents);

    logger.info(`📋 Cola creada para ${sourceId}: ${queueName}`);
  }

  /**
   * Agregar trabajo a la cola de una fuente
   */
  async addJob(
    sourceId: string, 
    parameters: ExtractionParameters, 
    userId?: string,
    priority?: number
  ): Promise<string> {
    const queue = this.queues.get(sourceId);
    
    if (!queue) {
      throw new Error(`Cola no encontrada para fuente: ${sourceId}`);
    }

    const jobId = this.generateJobId(sourceId);
    const jobData: QueueJobData = {
      sourceId,
      parameters,
      userId,
      jobId
    };

    try {
      const job = await queue.add(`extract:${sourceId}`, jobData, {
        jobId,
        priority: priority || 0,
        delay: 0
      });

      logger.info(`📝 Trabajo agregado a la cola ${sourceId}: ${jobId}`);
      
      // Notificar al usuario si está disponible
      if (userId) {
        sseController.sendEvent(userId, 'scraping_progress', {
          jobId,
          status: JobStatus.PENDING,
          progress: 0,
          message: 'Trabajo agregado a la cola',
          sourceId
        });
      }

      return jobId;

    } catch (error) {
      logger.error(`❌ Error agregando trabajo a la cola ${sourceId}:`, error);
      throw error;
    }
  }

  /**
   * Procesar trabajo de scraping
   */
  private async processScrapingJob(job: Job<QueueJobData>): Promise<any> {
    const { sourceId, parameters, userId, jobId } = job.data;
    
    logger.info(`🔄 Procesando trabajo ${jobId} para ${sourceId}`);
    
    try {
      // Actualizar progreso a "procesando"
      await job.updateProgress(10);
      
      if (userId) {
        sseController.sendEvent(userId, 'scraping_progress', {
          jobId,
          status: JobStatus.RUNNING,
          progress: 10,
          message: 'Iniciando procesamiento...',
          sourceId
        });
      }

      // Ejecutar extracción usando el orquestador
      const result = await this.orchestrator.extractDocuments(sourceId, parameters, userId);
      
      // Actualizar progreso final
      await job.updateProgress(100);
      
      if (userId) {
        sseController.sendEvent(userId, 'scraping_progress', {
          jobId,
          status: JobStatus.COMPLETED,
          progress: 100,
          message: `Completado - ${result.result?.documents.length || 0} documentos`,
          sourceId,
          documentsFound: result.result?.totalFound,
          documentsProcessed: result.result?.documents.length
        });
      }

      logger.info(`✅ Trabajo completado ${jobId}: ${result.result?.documents.length || 0} documentos`);
      
      return {
        success: true,
        jobId: result.jobId,
        documentsCount: result.result?.documents.length || 0,
        extractionTime: result.result?.extractionTime || 0
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error(`❌ Error procesando trabajo ${jobId}:`, error);
      
      if (userId) {
        sseController.sendEvent(userId, 'scraping_progress', {
          jobId,
          status: JobStatus.FAILED,
          progress: 0,
          message: `Error: ${errorMessage}`,
          sourceId
        });
      }

      throw error;
    }
  }

  /**
   * Obtener estado de un trabajo
   */
  async getJobStatus(jobId: string): Promise<any> {
    // Buscar en todas las colas
    for (const [sourceId, queue] of this.queues.entries()) {
      try {
        const job = await queue.getJob(jobId);
        
        if (job) {
          return {
            id: job.id,
            sourceId,
            status: await job.getState(),
            progress: job.progress,
            data: job.data,
            returnValue: job.returnvalue,
            failedReason: job.failedReason,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            timestamp: job.timestamp,
            attempts: job.attemptsMade,
            maxAttempts: job.opts.attempts
          };
        }
      } catch (error) {
        // Continuar buscando en otras colas
        continue;
      }
    }

    return null;
  }

  /**
   * Cancelar un trabajo
   */
  async cancelJob(jobId: string): Promise<boolean> {
    for (const [sourceId, queue] of this.queues.entries()) {
      try {
        const job = await queue.getJob(jobId);
        
        if (job) {
          await job.remove();
          logger.info(`⏹️ Trabajo cancelado: ${jobId} en ${sourceId}`);
          return true;
        }
      } catch (error) {
        continue;
      }
    }

    return false;
  }

  /**
   * Obtener estadísticas de las colas
   */
  async getQueueStats(): Promise<any> {
    const stats: any = {};

    for (const [sourceId, queue] of this.queues.entries()) {
      try {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();

        stats[sourceId] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          total: waiting.length + active.length + completed.length + failed.length
        };
      } catch (error) {
        stats[sourceId] = {
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return stats;
  }

  /**
   * Configurar listeners del worker
   */
  private setupWorkerListeners(worker: Worker, sourceId: string): void {
    worker.on('completed', (job, result) => {
      logger.info(`✅ Worker ${sourceId} completado: Job ${job.id}`);
    });

    worker.on('failed', (job, err) => {
      logger.error(`❌ Worker ${sourceId} falló: Job ${job?.id}`, err);
    });

    worker.on('stalled', (jobId) => {
      logger.warn(`⚠️ Worker ${sourceId} bloqueado: Job ${jobId}`);
    });

    worker.on('error', (err) => {
      logger.error(`❌ Error en worker ${sourceId}:`, err);
    });
  }

  /**
   * Configurar listeners de eventos de cola
   */
  private setupQueueListeners(queueEvents: QueueEvents, sourceId: string): void {
    queueEvents.on('waiting', ({ jobId }) => {
      logger.info(`⏳ Trabajo esperando en ${sourceId}: ${jobId}`);
    });

    queueEvents.on('active', ({ jobId }) => {
      logger.info(`🔄 Trabajo activo en ${sourceId}: ${jobId}`);
    });

    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      logger.info(`✅ Trabajo completado en ${sourceId}: ${jobId}`);
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error(`❌ Trabajo falló en ${sourceId}: ${jobId} - ${failedReason}`);
    });
  }

  /**
   * Configurar manejadores de eventos de Redis
   */
  private setupRedisEventHandlers(): void {
    this.redis.on('connect', () => {
      logger.info('🔗 Conectado a Redis');
    });

    this.redis.on('error', (error) => {
      logger.error('❌ Error de Redis:', error);
    });

    this.redis.on('close', () => {
      logger.warn('⚠️ Conexión Redis cerrada');
    });
  }

  /**
   * Generar ID único para trabajos
   */
  private generateJobId(sourceId: string): string {
    return `${sourceId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Limpiar recursos del gestor de colas
   */
  async cleanup(): Promise<void> {
    logger.info('🧹 Limpiando QueueManager...');

    // Cerrar workers
    for (const [sourceId, worker] of this.workers.entries()) {
      try {
        await worker.close();
        logger.info(`🔴 Worker cerrado: ${sourceId}`);
      } catch (error) {
        logger.error(`Error cerrando worker ${sourceId}:`, error);
      }
    }

    // Cerrar eventos de cola
    for (const [sourceId, queueEvents] of this.queueEvents.entries()) {
      try {
        await queueEvents.close();
        logger.info(`🔴 QueueEvents cerrado: ${sourceId}`);
      } catch (error) {
        logger.error(`Error cerrando queueEvents ${sourceId}:`, error);
      }
    }

    // Cerrar colas
    for (const [sourceId, queue] of this.queues.entries()) {
      try {
        await queue.close();
        logger.info(`🔴 Cola cerrada: ${sourceId}`);
      } catch (error) {
        logger.error(`Error cerrando cola ${sourceId}:`, error);
      }
    }

    // Cerrar conexión Redis
    try {
      await this.redis.quit();
      logger.info('🔴 Conexión Redis cerrada');
    } catch (error) {
      logger.error('Error cerrando Redis:', error);
    }

    this.isInitialized = false;
  }
}