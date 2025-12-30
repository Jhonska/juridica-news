import { convert } from 'mammoth';
import PDFDocument from 'pdfkit';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '@/utils/logger';

export class DocumentToPdfService {
  /**
   * Convierte un documento DOCX a PDF
   */
  async convertToPdf(documentPath: string): Promise<Buffer> {
    let fileHandle: any = null;

    try {
      logger.info(`🔄 Iniciando conversión a PDF: ${documentPath}`);

      // Verificar que el archivo existe usando fs.promises
      try {
        await fs.access(documentPath);
      } catch {
        throw new Error(`Archivo no encontrado: ${documentPath}`);
      }

      const ext = path.extname(documentPath).toLowerCase();

      // Extraer contenido según el tipo de archivo
      let plainText = '';

      if (ext === '.docx' || ext === '.doc') {
        logger.info('📄 Extrayendo contenido DOCX con Mammoth...');
        const docBuffer = await fs.readFile(documentPath);
        const result = await convert({ arrayBuffer: docBuffer.buffer });

        // Convertir HTML a texto plano
        plainText = result.value
          .replace(/<[^>]*>/g, '') // Remover tags HTML
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .trim();

        logger.info(`📊 Contenido DOCX extraído: ${plainText.length} caracteres`);
      } else if (ext === '.rtf' || ext === '.txt') {
        logger.info('📄 Leyendo contenido de texto...');
        const buffer = await fs.readFile(documentPath);
        plainText = buffer.toString('utf-8').trim();

        logger.info(`📊 Contenido de texto leído: ${plainText.length} caracteres`);
      } else {
        throw new Error(`Formato no soportado: ${ext}`);
      }

      // Validar que tenemos contenido
      if (!plainText || plainText.length === 0) {
        throw new Error('El documento está vacío o no contiene texto');
      }

      // Crear PDF
      logger.info('📄 Generando PDF con PDFKit...');

      return new Promise((resolve, reject) => {
        try {
          const chunks: Buffer[] = [];
          let errorOccurred = false;

          const doc = new PDFDocument({
            size: 'A4',
            margin: 40,
            bufferPages: true,
            autoFirstPage: true
          });

          // Recopilar datos conforme se emite
          const onData = (chunk: Buffer) => {
            try {
              chunks.push(chunk);
            } catch (error) {
              logger.error('❌ Error manejando chunk de PDF:', error);
              errorOccurred = true;
              reject(error);
            }
          };

          const onEnd = () => {
            if (!errorOccurred) {
              try {
                const pdfBuffer = Buffer.concat(chunks);
                logger.info(`✅ PDF generado exitosamente: ${pdfBuffer.length} bytes`);
                resolve(pdfBuffer);
              } catch (error) {
                logger.error('❌ Error concatenando chunks:', error);
                reject(error);
              }
            }
          };

          const onError = (error: Error) => {
            logger.error('❌ Error en PDFKit stream:', error.message, error.stack);
            errorOccurred = true;
            reject(error);
          };

          doc.on('data', onData);
          doc.on('end', onEnd);
          doc.on('error', onError);

          try {
            // Escribir contenido en el PDF
            // Usar solo 'Helvetica' que está garantizada en todos los sistemas
            doc.fontSize(16).text('SENTENCIA', { align: 'center', underline: false });
            doc.moveDown(0.5);

            // Dividir texto en párrafos para mejor manejo
            const paragraphs = plainText.split(/\n\n+/);

            for (const paragraph of paragraphs) {
              if (paragraph.trim().length > 0) {
                doc.fontSize(11).text(paragraph.trim(), {
                  align: 'left',
                  lineGap: 4,
                  width: doc.page.width - 80 // Account for margins
                });
                doc.moveDown(0.3);
              }
            }

            // Finalizar el documento
            doc.end();

          } catch (error) {
            logger.error('❌ Error escribiendo contenido en PDF:', error);
            errorOccurred = true;
            reject(error);
          }

        } catch (error) {
          logger.error('❌ Error inicializando PDFDocument:', error);
          reject(error);
        }
      });

    } catch (error) {
      logger.error('❌ Error en conversión a PDF:', {
        documentPath,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}

export const documentToPdfService = new DocumentToPdfService();
