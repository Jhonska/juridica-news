import { convert } from 'mammoth';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { logger } from '@/utils/logger';

export class DocumentToPdfService {
  /**
   * Convierte un documento DOCX a PDF
   */
  async convertToPdf(documentPath: string): Promise<Buffer> {
    try {
      logger.info(`🔄 Iniciando conversión a PDF: ${documentPath}`);

      // Verificar que el archivo existe
      if (!fs.existsSync(documentPath)) {
        throw new Error(`Archivo no encontrado: ${documentPath}`);
      }

      const ext = path.extname(documentPath).toLowerCase();

      // Extraer contenido según el tipo de archivo
      let plainText = '';

      if (ext === '.docx' || ext === '.doc') {
        logger.info('📄 Extrayendo contenido DOCX con Mammoth...');
        const docBuffer = fs.readFileSync(documentPath);
        const result = await convert({ arrayBuffer: docBuffer });

        // Convertir HTML a texto plano
        plainText = result.value
          .replace(/<[^>]*>/g, '') // Remover tags HTML
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .trim();
      } else if (ext === '.rtf' || ext === '.txt') {
        logger.info('📄 Leyendo contenido de texto...');
        plainText = fs.readFileSync(documentPath, 'utf-8').trim();
      } else {
        throw new Error(`Formato no soportado: ${ext}`);
      }

      // Crear PDF
      logger.info('📄 Generando PDF...');

      return new Promise((resolve, reject) => {
        try {
          const chunks: Buffer[] = [];

          const doc = new PDFDocument({
            size: 'A4',
            margin: 40
          });

          // Recopilar datos conforme se emite
          doc.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          doc.on('end', () => {
            const pdfBuffer = Buffer.concat(chunks);
            logger.info('✅ PDF generado exitosamente');
            resolve(pdfBuffer);
          });

          doc.on('error', (error: Error) => {
            logger.error('❌ Error en PDFKit:', error.message);
            reject(error);
          });

          // Escribir contenido en el PDF
          doc.fontSize(14).font('Helvetica-Bold').text('SENTENCIA', { align: 'center' });
          doc.moveDown(0.5);

          doc.fontSize(11).font('Helvetica').text(plainText, {
            align: 'justify',
            lineGap: 4
          });

          // Finalizar el documento
          doc.end();

        } catch (error) {
          logger.error('❌ Error creando PDF:', error);
          reject(error);
        }
      });

    } catch (error) {
      logger.error('❌ Error en conversión a PDF:', {
        documentPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

export const documentToPdfService = new DocumentToPdfService();
