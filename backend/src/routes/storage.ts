import { Router, Request, Response } from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { imageTagService, ImageTag } from '@/services/ImageTagService';
import { validateRequest } from '@/middleware/validation';
import { cleanOrphanImages, checkImageStatus } from '@/utils/cleanOrphanImages';
import { documentToPdfService } from '@/services/DocumentToPdfService';

const router = Router();
const prisma = new PrismaClient();

// Validation schemas
const saveImageToLibrarySchema = z.object({
  imageId: z.string().cuid(),
  customTags: z.array(z.string()).optional(),
  isPublic: z.boolean().default(false)
});

const saveImageFromUrlSchema = z.object({
  imageUrl: z.string().min(1), // Cambiar de url() a min(1) para aceptar rutas locales
  prompt: z.string().min(1),
  model: z.string().optional(),
  style: z.enum(['persona', 'paisaje', 'elemento']).optional(),
  documentId: z.string().cuid().optional(),
  customTags: z.array(z.string()).optional(),
  isPublic: z.boolean().default(false),
  metaDescription: z.string().max(125).nullable().optional()
});

const getLibraryImagesSchema = z.object({
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  documentId: z.string().cuid().optional(),
  style: z.enum(['persona', 'paisaje', 'elemento']).optional(),
  model: z.enum(['dalle', 'gemini']).optional(),
  limit: z.number().min(1).max(50).default(20),
  offset: z.number().min(0).default(0)
});

const updateImageTagsSchema = z.object({
  tags: z.array(z.string())
});

/**
 * @swagger
 * /api/storage/images/tags:
 *   get:
 *     summary: Obtiene todas las etiquetas disponibles
 *     tags: [Storage]
 *     responses:
 *       200:
 *         description: Lista de etiquetas organizadas por categoría
 */
router.get('/images/tags', async (req: Request, res: Response) => {
  try {
    const availableTags = imageTagService.getAllAvailableTags();

    // También obtener etiquetas personalizadas usadas
    const imagesWithCustomTags = await prisma.generatedImage.findMany({
      where: {
        savedToLibrary: true,
        tags: {
          not: '[]'
        }
      },
      select: {
        tags: true
      }
    });

    const customTags = new Set<string>();
    imagesWithCustomTags.forEach(image => {
      const tags = imageTagService.jsonToTags(image.tags);
      tags.filter(tag => tag.category === 'custom').forEach(tag => {
        customTags.add(tag.name);
      });
    });

    res.json({
      success: true,
      data: {
        predefined: availableTags,
        custom: Array.from(customTags).map(name => ({
          id: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          category: 'custom',
          color: '#6B7280'
        }))
      }
    });

  } catch (error) {
    logger.error('❌ Error obteniendo etiquetas:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/library:
 *   get:
 *     summary: Obtiene imágenes de la biblioteca con filtros
 *     tags: [Storage]
 *     parameters:
 *       - in: query
 *         name: tags
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Filtrar por etiquetas
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Búsqueda en prompt
 *       - in: query
 *         name: documentId
 *         schema:
 *           type: string
 *         description: ID del documento actual
 *       - in: query
 *         name: style
 *         schema:
 *           type: string
 *           enum: [persona, paisaje, elemento]
 *         description: Filtrar por estilo
 *       - in: query
 *         name: model
 *         schema:
 *           type: string
 *           enum: [dalle, gemini]
 *         description: Filtrar por modelo
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Límite de resultados
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Offset para paginación
 *     responses:
 *       200:
 *         description: Lista de imágenes de biblioteca
 */
router.get('/images/library', async (req: Request, res: Response) => {
  try {
    const {
      tags,
      search,
      documentId,
      style,
      model,
      limit = 20,
      offset = 0
    } = req.query;

    // Construir filtros where
    const whereClause: any = {
      savedToLibrary: true
    };

    // Filtro por estilo
    if (style) {
      whereClause.style = style;
    }

    // Filtro por modelo
    if (model) {
      whereClause.model = model;
    }

    // Filtro por búsqueda en prompt
    if (search && typeof search === 'string') {
      whereClause.prompt = {
        contains: search,
        mode: 'insensitive'
      };
    }

    // Si se proporciona documentId, incluir imágenes del documento + públicas
    if (documentId) {
      whereClause.OR = [
        { documentId: documentId },
        { isPublic: true }
      ];
    } else {
      // Solo imágenes públicas si no se especifica documento
      whereClause.isPublic = true;
    }

    // Buscar imágenes
    const images = await prisma.generatedImage.findMany({
      where: whereClause,
      include: {
        document: {
          select: {
            id: true,
            title: true,
            legalArea: true,
            temaPrincipal: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: Number(limit),
      skip: Number(offset)
    });

    // Procesar y filtrar por etiquetas si se especifican
    let filteredImages = images;
    if (tags && Array.isArray(tags) && tags.length > 0) {
      filteredImages = images.filter(image => {
        const imageTags = imageTagService.jsonToTags(image.tags);
        return tags.some(tag =>
          imageTags.some(imageTag =>
            imageTag.id === tag || imageTag.name.toLowerCase().includes(tag.toLowerCase())
          )
        );
      });
    }

    // Formatear respuesta
    const formattedImages = filteredImages.map(image => {
      const imageTags = imageTagService.jsonToTags(image.tags);
      return {
        id: image.id,
        imageId: image.imageId,
        filename: image.filename,
        url: `/api/storage/images/${image.filename}`,
        prompt: image.prompt,
        metaDescription: image.metaDescription,
        style: image.style,
        model: image.model,
        tags: imageTags,
        size: image.size,
        dimensions: {
          width: image.width,
          height: image.height
        },
        usageCount: image.usageCount,
        isPublic: image.isPublic,
        createdAt: image.createdAt,
        lastUsedAt: image.lastUsedAt,
        document: image.document ? {
          id: image.document.id,
          title: image.document.title,
          legalArea: image.document.legalArea,
          temaPrincipal: image.document.temaPrincipal
        } : null
      };
    });

    // Contar total para paginación
    const total = await prisma.generatedImage.count({
      where: whereClause
    });

    logger.info('📚 Imágenes de biblioteca recuperadas', {
      total: filteredImages.length,
      filters: { tags, search, style, model, documentId },
      pagination: { limit, offset }
    });

    res.json({
      success: true,
      data: {
        images: formattedImages,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset),
          hasNext: Number(offset) + Number(limit) < total
        },
        filters: { tags, search, style, model }
      }
    });

  } catch (error) {
    logger.error('❌ Error obteniendo biblioteca de imágenes:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/save:
 *   post:
 *     summary: Guarda una imagen generada en la biblioteca
 *     tags: [Storage]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageId:
 *                 type: string
 *                 description: ID de la imagen generada
 *               customTags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Etiquetas personalizadas adicionales
 *               isPublic:
 *                 type: boolean
 *                 description: Si la imagen es compartible entre documentos
 *     responses:
 *       200:
 *         description: Imagen guardada en biblioteca exitosamente
 *       404:
 *         description: Imagen no encontrada
 *       500:
 *         description: Error interno del servidor
 */
router.post('/images/save', validateRequest(saveImageToLibrarySchema), async (req: Request, res: Response) => {
  try {
    const { imageId, customTags = [], isPublic = false } = req.body;

    // Buscar la imagen generada
    const image = await prisma.generatedImage.findFirst({
      where: { imageId },
      include: { document: true }
    });

    if (!image) {
      return res.status(404).json({
        error: 'Imagen no encontrada'
      });
    }

    // Generar etiquetas automáticas
    const autoTags = await imageTagService.generateAutoTags({
      legalArea: image.document?.legalArea,
      temaPrincipal: image.document?.temaPrincipal,
      prompt: image.prompt,
      style: image.style,
      documentTitle: image.document?.title
    });

    // Combinar etiquetas automáticas y personalizadas
    const allTags = [...autoTags];
    customTags.forEach((tagName: string) => {
      if (!allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase())) {
        allTags.push({
          id: tagName.toLowerCase().replace(/\s+/g, '-'),
          name: tagName,
          category: 'custom' as const,
          color: '#6B7280',
          description: 'Etiqueta personalizada'
        });
      }
    });

    // Actualizar imagen con etiquetas y estado de biblioteca
    const updatedImage = await prisma.generatedImage.update({
      where: { id: image.id },
      data: {
        tags: imageTagService.tagsToJson(allTags),
        savedToLibrary: true,
        isPublic
      },
      include: { document: true }
    });

    logger.info('📚 Imagen guardada en biblioteca', {
      imageId,
      totalTags: allTags.length,
      autoTags: autoTags.length,
      customTags: customTags.length,
      isPublic
    });

    res.json({
      success: true,
      data: {
        imageId: updatedImage.imageId,
        filename: updatedImage.filename,
        tags: allTags,
        savedToLibrary: true,
        isPublic: updatedImage.isPublic,
        url: `/api/storage/images/${updatedImage.filename}`
      }
    });

  } catch (error) {
    logger.error('❌ Error guardando imagen en biblioteca:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/save-from-url:
 *   post:
 *     summary: Crear y guardar una nueva imagen en la biblioteca desde URL
 *     tags: [Storage]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageUrl
 *               - prompt
 *             properties:
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL de la imagen a guardar
 *               prompt:
 *                 type: string
 *                 description: Prompt usado para generar la imagen
 *               model:
 *                 type: string
 *                 description: Modelo de IA usado
 *               style:
 *                 type: string
 *                 enum: [persona, paisaje, elemento]
 *                 description: Estilo de la imagen
 *               documentId:
 *                 type: string
 *                 description: ID del documento asociado
 *               customTags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Etiquetas personalizadas
 *               isPublic:
 *                 type: boolean
 *                 default: false
 *                 description: Si la imagen es pública
 *     responses:
 *       201:
 *         description: Imagen creada y guardada exitosamente
 *       400:
 *         description: Datos de entrada inválidos
 *       500:
 *         description: Error interno del servidor
 */
router.post('/images/save-from-url', async (req: Request, res: Response) => {
  try {
    // Log del cuerpo de la petición antes de validar (sin base64 para debug)
    const { imageUrl, ...bodyWithoutImage } = req.body;
    logger.info('🔍 DEBUG: Cuerpo de petición recibido:', {
      fields: bodyWithoutImage,
      imageUrlType: typeof imageUrl,
      imageUrlLength: imageUrl?.length || 0,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length']
    });

    // Validación manual con mejor error handling
    const validation = saveImageFromUrlSchema.safeParse(req.body);
    if (!validation.success) {
      logger.error('❌ Validation failed with details:', {
        errors: validation.error.errors.map(err => ({
          path: err.path,
          message: err.message,
          code: err.code,
          received: err.code === 'invalid_type' ? typeof req.body[err.path[0] as string] : req.body[err.path[0] as string]
        })),
        fields: Object.keys(req.body),
        types: Object.entries(req.body).reduce((acc, [key, val]) => {
          acc[key] = typeof val;
          return acc;
        }, {} as Record<string, string>)
      });
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors
      });
    }

    const { imageUrl: validatedUrl, prompt, model, style, documentId, customTags = [], isPublic = false, metaDescription } = validation.data;

    // Generar un filename único para la imagen
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 15);
    const filename = `generated-${timestamp}-${randomId}.jpg`;

    // Información de la imagen que se guardará
    let imageSize = 0;
    let localFilePath = '';

    // Si es una URL base64, guardar la imagen localmente
    if (validatedUrl.startsWith('data:image/')) {
      try {
        const fs = require('fs');
        const path = require('path');

        // Extraer los datos base64
        const base64Data = validatedUrl.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        imageSize = imageBuffer.length;

        // Asegurar que el directorio de imágenes existe
        const imagesDir = path.join(process.cwd(), 'storage', 'images');
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }

        // Guardar la imagen
        localFilePath = path.join(imagesDir, filename);
        fs.writeFileSync(localFilePath, imageBuffer);

        logger.info('💾 Imagen base64 guardada localmente', {
          filename,
          size: imageSize,
          path: localFilePath
        });
      } catch (saveError) {
        logger.error('❌ Error guardando imagen base64:', saveError);
        // Continuar con el proceso aunque no se pueda guardar la imagen
      }
    }
    // Si es una URL HTTP/HTTPS (DALL-E), descargar y guardar
    else if (validatedUrl.startsWith('http://') || validatedUrl.startsWith('https://')) {
      try {
        const fs = require('fs');
        const path = require('path');

        logger.info('📥 Descargando imagen desde URL de DALL-E', {
          url: validatedUrl.substring(0, 100) + '...'
        });

        const imageResponse = await fetch(validatedUrl);
        if (!imageResponse.ok) {
          throw new Error(`HTTP ${imageResponse.status}: ${imageResponse.statusText}`);
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        imageSize = imageBuffer.length;

        // Asegurar que el directorio de imágenes existe
        const imagesDir = path.join(process.cwd(), 'storage', 'images');
        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }

        // Guardar archivo físico
        localFilePath = path.join(imagesDir, filename);
        fs.writeFileSync(localFilePath, imageBuffer);

        logger.info('✅ Imagen de DALL-E guardada localmente', {
          filename,
          size: imageSize,
          path: localFilePath
        });
      } catch (downloadError) {
        logger.error('❌ Error descargando imagen de DALL-E:', downloadError);
        // Continuar con el proceso aunque no se pueda descargar
      }
    }

    // Generar etiquetas automáticas
    let autoTags: any[] = [];

    if (documentId) {
      // Buscar el documento para obtener información adicional
      const document = await prisma.document.findUnique({
        where: { id: documentId }
      });

      if (document) {
        autoTags = await imageTagService.generateAutoTags({
          legalArea: document.legalArea,
          temaPrincipal: document.temaPrincipal,
          prompt,
          style,
          documentTitle: document.title
        });
      }
    } else {
      // Generar etiquetas solo basadas en el prompt
      autoTags = await imageTagService.generateAutoTags({
        prompt,
        style
      });
    }

    // Combinar etiquetas
    const customTagObjects = customTags.map(tag => ({
      id: `custom-${tag.toLowerCase().replace(/\s+/g, '-')}`,
      name: tag,
      category: 'custom' as const,
      color: '#6B7280'
    }));

    const allTags = [...autoTags, ...customTagObjects];

    // Crear la imagen en la base de datos
    // Para imágenes desde URL no guardamos la URL completa (puede ser base64 muy largo)
    // En su lugar usamos la ruta del archivo local
    const localImageUrl = `/api/storage/images/${filename}`;

    const newImage = await prisma.generatedImage.create({
      data: {
        imageId: `img_${randomId}`,
        filename,
        originalUrl: validatedUrl.startsWith('data:image/') ? 'base64-image' : validatedUrl,
        localPath: localFilePath || localImageUrl,
        size: imageSize || 0,
        format: 'jpeg',
        prompt,
        metaDescription,
        model: model || 'unknown',
        style: style || 'persona',
        width: 1024,
        height: 1024,
        documentId,
        tags: imageTagService.tagsToJson(allTags),
        savedToLibrary: true,
        isPublic,
        usageCount: 0
      }
    });

    logger.info('✅ Imagen creada y guardada en biblioteca desde URL', {
      imageId: newImage.imageId,
      filename: newImage.filename,
      totalTags: allTags.length,
      autoTags: autoTags.length,
      customTags: customTags.length,
      isPublic,
      documentId
    });

    res.status(201).json({
      success: true,
      data: {
        imageId: newImage.imageId,
        filename: newImage.filename,
        tags: allTags,
        savedToLibrary: true,
        isPublic: newImage.isPublic,
        url: `/api/storage/images/${newImage.filename}`
      }
    });

  } catch (error) {
    logger.error('❌ Error creando imagen desde URL:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/{filename}:
 *   get:
 *     summary: Serve generated images from local storage
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: The filename of the image to serve
 *     responses:
 *       200:
 *         description: Image file
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Image not found
 *       500:
 *         description: Server error
 */
router.get('/images/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // Validar que el filename no contenga caracteres peligrosos
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        error: 'Invalid filename'
      });
    }

    // Construir la ruta del archivo
    const imagePath = path.join(process.cwd(), 'storage', 'images', filename);

    try {
      // Verificar que el archivo existe
      await fs.access(imagePath);

      // Obtener información del archivo
      const stats = await fs.stat(imagePath);

      // Determinar el content-type basado en la extensión
      const ext = path.extname(filename).toLowerCase();
      let contentType = 'application/octet-stream';

      switch (ext) {
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
        case '.webp':
          contentType = 'image/webp';
          break;
        case '.svg':
          contentType = 'image/svg+xml';
          break;
      }

      // Configurar headers de respuesta
      res.set({
        'Content-Type': contentType,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache por 1 año
        'ETag': `"${stats.mtime.getTime()}-${stats.size}"`,
        'Last-Modified': stats.mtime.toUTCString(),
      });

      // Verificar si el cliente ya tiene una versión cached
      const ifNoneMatch = req.get('If-None-Match');
      const etag = `"${stats.mtime.getTime()}-${stats.size}"`;

      if (ifNoneMatch === etag) {
        return res.status(304).end();
      }

      // Leer y enviar el archivo
      const imageBuffer = await fs.readFile(imagePath);
      res.send(imageBuffer);

      logger.info('Image served successfully', {
        filename,
        contentType,
        size: stats.size
      });

    } catch (fileError) {
      // El archivo no existe o no se puede leer
      logger.warn('Image file not found', {
        filename,
        imagePath,
        error: fileError instanceof Error ? fileError.message : 'Unknown error'
      });

      return res.status(404).json({
        error: 'Image not found'
      });
    }

  } catch (error) {
    logger.error('Error serving image', {
      filename: req.params.filename,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/storage/images:
 *   get:
 *     summary: Lista todas las imágenes almacenadas
 *     tags: [Storage]
 *     responses:
 *       200:
 *         description: Lista de imágenes exitosa
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalImages:
 *                       type: number
 *                     totalSize:
 *                       type: number
 *                       description: Tamaño total en bytes
 *                     images:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                           size:
 *                             type: number
 *                           url:
 *                             type: string
 *                           modifiedAt:
 *                             type: string
 *                             format: date-time
 */
router.get('/images', async (req: Request, res: Response) => {
  try {
    const imagesDir = path.join(process.cwd(), 'storage', 'images');

    // Crear directorio si no existe
    try {
      await fs.mkdir(imagesDir, { recursive: true });
    } catch {
      // Directorio ya existe
    }

    // Listar archivos
    const files = await fs.readdir(imagesDir);
    const imageFiles = files.filter(file =>
      /\.(jpg|jpeg|png|webp|gif)$/i.test(file)
    );

    let totalSize = 0;
    const images = [];

    for (const file of imageFiles) {
      try {
        const filePath = path.join(imagesDir, file);
        const stats = await fs.stat(filePath);

        totalSize += stats.size;

        images.push({
          filename: file,
          size: stats.size,
          url: `/api/storage/images/${file}`,
          modifiedAt: stats.mtime.toISOString()
        });
      } catch (error) {
        logger.warn('⚠️ Error obteniendo stats de archivo:', { file, error });
      }
    }

    // Ordenar por fecha de modificación (más reciente primero)
    images.sort((a, b) =>
      new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );

    res.json({
      success: true,
      data: {
        totalImages: images.length,
        totalSize,
        totalSizeFormatted: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
        images
      }
    });

    logger.info('📂 Lista de imágenes enviada', {
      totalImages: images.length,
      totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`
    });

  } catch (error) {
    logger.error('❌ Error listando imágenes:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

// Rutas duplicadas eliminadas - ya están definidas más arriba en el archivo

/**
 * @swagger
 * /api/storage/images/{id}/tags:
 *   put:
 *     summary: Actualiza las etiquetas de una imagen
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la imagen
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: IDs de las etiquetas
 *     responses:
 *       200:
 *         description: Etiquetas actualizadas exitosamente
 */
router.put('/images/:id/tags', validateRequest(updateImageTagsSchema), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tags: tagIds } = req.body;

    const image = await prisma.generatedImage.findUnique({
      where: { id }
    });

    if (!image) {
      return res.status(404).json({
        error: 'Imagen no encontrada'
      });
    }

    // Convertir IDs a objetos de etiquetas
    const availableTags = imageTagService.getAllAvailableTags();
    const tags: ImageTag[] = [];

    tagIds.forEach((tagId: string) => {
      Object.values(availableTags).forEach(categoryTags => {
        const tag = categoryTags.find(t => t.id === tagId);
        if (tag) {
          tags.push(tag);
        }
      });
    });

    // Actualizar imagen
    await prisma.generatedImage.update({
      where: { id },
      data: {
        tags: imageTagService.tagsToJson(tags)
      }
    });

    logger.info('🏷️ Etiquetas de imagen actualizadas', {
      imageId: image.imageId,
      tags: tags.map(t => t.name)
    });

    res.json({
      success: true,
      data: {
        imageId: image.imageId,
        tags
      }
    });

  } catch (error) {
    logger.error('❌ Error actualizando etiquetas:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/{id}/use:
 *   post:
 *     summary: Marca una imagen como usada (incrementa contador)
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la imagen
 *     responses:
 *       200:
 *         description: Uso registrado exitosamente
 */
router.post('/images/:id/use', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const image = await prisma.generatedImage.findUnique({
      where: { id }
    });

    if (!image) {
      return res.status(404).json({
        error: 'Imagen no encontrada'
      });
    }

    // Incrementar contador de uso
    const updatedImage = await prisma.generatedImage.update({
      where: { id },
      data: {
        usageCount: {
          increment: 1
        },
        lastUsedAt: new Date()
      }
    });

    logger.info('📊 Uso de imagen registrado', {
      imageId: image.imageId,
      newUsageCount: updatedImage.usageCount
    });

    res.json({
      success: true,
      data: {
        imageId: image.imageId,
        usageCount: updatedImage.usageCount,
        lastUsedAt: updatedImage.lastUsedAt
      }
    });

  } catch (error) {
    logger.error('❌ Error registrando uso de imagen:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/{id}:
 *   delete:
 *     summary: Elimina una imagen de la biblioteca
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la imagen
 *     responses:
 *       200:
 *         description: Imagen eliminada exitosamente
 */
router.delete('/images/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const image = await prisma.generatedImage.findUnique({
      where: { id }
    });

    if (!image) {
      return res.status(404).json({
        error: 'Imagen no encontrada'
      });
    }

    // Eliminar archivo físico
    try {
      const imagesDir = path.join(process.cwd(), 'storage', 'images');
      const imagePath = path.join(imagesDir, image.filename);
      await fs.unlink(imagePath);
    } catch (fileError) {
      logger.warn('⚠️ No se pudo eliminar archivo físico:', fileError);
    }

    // Eliminar registro de base de datos
    await prisma.generatedImage.delete({
      where: { id }
    });

    logger.info('🗑️ Imagen eliminada de biblioteca', {
      imageId: image.imageId,
      filename: image.filename
    });

    res.json({
      success: true,
      message: 'Imagen eliminada exitosamente'
    });

  } catch (error) {
    logger.error('❌ Error eliminando imagen:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/associate-document:
 *   post:
 *     summary: Asocia una imagen de biblioteca con un documento
 *     tags: [Storage]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageId
 *               - documentId
 *             properties:
 *               imageId:
 *                 type: string
 *                 description: ID de la imagen en la base de datos
 *               documentId:
 *                 type: string
 *                 description: ID del documento a asociar
 *     responses:
 *       200:
 *         description: Imagen asociada exitosamente con el documento
 *       404:
 *         description: Imagen o documento no encontrado
 *       500:
 *         description: Error interno del servidor
 */
router.post('/images/associate-document', async (req: Request, res: Response) => {
  try {
    const { imageId, documentId } = req.body;

    // Validar que se proporcionen ambos IDs
    if (!imageId || !documentId) {
      return res.status(400).json({
        error: 'Se requieren imageId y documentId'
      });
    }

    // Verificar que la imagen existe
    const image = await prisma.generatedImage.findUnique({
      where: { id: imageId }
    });

    if (!image) {
      return res.status(404).json({
        error: 'Imagen no encontrada'
      });
    }

    // Verificar que el documento existe
    const document = await prisma.document.findUnique({
      where: { id: documentId }
    });

    if (!document) {
      return res.status(404).json({
        error: 'Documento no encontrado'
      });
    }

    // Asociar imagen con documento
    const updatedImage = await prisma.generatedImage.update({
      where: { id: imageId },
      data: {
        documentId: documentId
      }
    });

    logger.info('🔗 Imagen asociada con documento', {
      imageId: updatedImage.imageId,
      documentId,
      documentTitle: document.title
    });

    res.json({
      success: true,
      message: 'Imagen asociada exitosamente con el documento',
      data: {
        imageId: updatedImage.imageId,
        documentId,
        documentTitle: document.title
      }
    });

  } catch (error) {
    logger.error('❌ Error asociando imagen con documento:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/cleanup:
 *   post:
 *     summary: Limpia imágenes huérfanas de la base de datos
 *     tags: [Storage]
 *     responses:
 *       200:
 *         description: Limpieza completada exitosamente
 */
router.post('/images/cleanup', async (req: Request, res: Response) => {
  try {
    const result = await cleanOrphanImages();

    logger.info('🧹 Limpieza de imágenes completada', result);

    res.json({
      success: true,
      message: 'Limpieza de imágenes completada',
      data: result
    });

  } catch (error) {
    logger.error('❌ Error en limpieza de imágenes:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/images/check/{imageId}:
 *   get:
 *     summary: Verifica el estado de una imagen específica
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la imagen a verificar
 *     responses:
 *       200:
 *         description: Estado de la imagen
 */
router.get('/images/check/:imageId', async (req: Request, res: Response) => {
  try {
    const { imageId } = req.params;
    const result = await checkImageStatus(imageId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('❌ Error verificando imagen:', error);
    res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * @swagger
 * /api/storage/documents/{filename}/text:
 *   get:
 *     summary: Extrae el texto de un documento DOCX local
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre del archivo (ej. C-383-25.docx)
 *     responses:
 *       200:
 *         description: Texto extraído exitosamente
 *       404:
 *         description: Documento no encontrado
 *       500:
 *         description: Error al procesar el documento
 */
router.get('/documents/:filename/text', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // Validar que el filename no tenga path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: 'Nombre de archivo inválido'
      });
    }

    const documentsDir = path.join(__dirname, '../../storage/documents');
    const filePath = path.join(documentsDir, filename);

    // Verificar que el archivo existe
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'Documento no encontrado'
      });
    }

    // Leer el archivo
    const buffer = await fs.readFile(filePath);

    // Usar Mammoth para extraer texto si es DOCX
    const ext = path.extname(filename).toLowerCase();

    if (ext === '.docx' || ext === '.doc') {
      // Importar mammoth dinámicamente
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });

      // Formatear el texto para mejor visualización
      const formattedText = result.value
        .replace(/\n{3,}/g, '\n\n') // Reducir múltiples líneas vacías
        .trim();

      return res.json({
        success: true,
        data: {
          text: formattedText,
          filename,
          wordCount: formattedText.split(/\s+/).filter(w => w.length > 0).length,
          charCount: formattedText.length
        }
      });
    } else if (ext === '.rtf') {
      // Para RTF, intentar leer como texto plano (limitado)
      const text = buffer.toString('utf-8');
      // Remover marcadores RTF básicos
      const cleanedText = text
        .replace(/\{\\[^{}]+\}/g, '') // Remover grupos RTF
        .replace(/\\[a-z]+\d* ?/gi, '') // Remover comandos RTF
        .replace(/[{}]/g, '') // Remover llaves
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return res.json({
        success: true,
        data: {
          text: cleanedText || 'No se pudo extraer texto del archivo RTF',
          filename,
          wordCount: cleanedText.split(/\s+/).filter(w => w.length > 0).length,
          charCount: cleanedText.length
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: `Formato no soportado: ${ext}. Solo se soportan .docx y .rtf`
      });
    }

  } catch (error) {
    logger.error('❌ Error extrayendo texto del documento:', error);
    res.status(500).json({
      success: false,
      error: 'Error al procesar el documento'
    });
  }
});

/**
 * @swagger
 * /api/storage/documents/{filename}/pdf:
 *   get:
 *     summary: Descarga un documento convertido a PDF
 *     tags: [Storage]
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre del archivo (ej. C-383-25.docx)
 *     responses:
 *       200:
 *         description: PDF generado exitosamente
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Documento no encontrado
 *       500:
 *         description: Error al convertir el documento
 */
router.get('/documents/:filename/pdf', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;

    // ✅ FIXED: Validar que el filename no tenga path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        error: 'Nombre de archivo inválido'
      });
    }

    // Construir ruta al documento
    const documentsDir = path.join(__dirname, '../../storage/documents');
    const filePath = path.join(documentsDir, filename);

    // Verificar que el archivo existe
    try {
      await fs.access(filePath);
    } catch {
      logger.warn('Documento no encontrado', { filename, filePath });
      return res.status(404).json({
        success: false,
        error: 'Documento no encontrado'
      });
    }

    // Validar extensión
    const ext = path.extname(filename).toLowerCase();
    if (!['.docx', '.doc', '.rtf', '.txt'].includes(ext)) {
      return res.status(400).json({
        success: false,
        error: `Formato no soportado: ${ext}. Solo se soportan .docx, .doc, .rtf y .txt`
      });
    }

    logger.info('📄 Iniciando conversión a PDF', {
      filename,
      ext,
      filePath
    });

    // Convertir documento a PDF
    const pdfBuffer = await documentToPdfService.convertToPdf(filePath);

    // Generar nombre para el PDF
    const pdfFilename = filename.replace(/\.[^/.]+$/, '.pdf');

    // Enviar el PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-store');

    res.send(pdfBuffer);

    logger.info('✅ PDF descargado exitosamente', {
      originalFilename: filename,
      pdfFilename,
      pdfSize: pdfBuffer.length
    });

  } catch (error) {
    logger.error('❌ Error convirtiendo documento a PDF:', {
      filename: req.params.filename,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    // Enviar error genérico al cliente
    res.status(500).json({
      success: false,
      error: 'Error al convertir el documento a PDF'
    });
  }
});

export default router;