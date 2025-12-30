import { convert } from 'mammoth';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { logger } from '@/utils/logger';

export class DocumentToPdfService {
  /**
   * Convierte un documento DOCX a PDF
   * @param documentPath - Ruta al archivo DOCX
   * @param outputPath - Ruta donde guardar el PDF (opcional)
   * @returns Buffer del PDF generado
   */
  async convertDocxToPdf(documentPath: string, outputPath?: string): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        logger.info(`🔄 Iniciando conversión de DOCX a PDF: ${documentPath}`);

        // 1. Verificar que el archivo existe
        if (!fs.existsSync(documentPath)) {
          throw new Error(`Archivo no encontrado: ${documentPath}`);
        }

        // 2. Convertir DOCX a HTML usando Mammoth
        logger.info('📄 Extrayendo contenido con Mammoth...');
        const docBuffer = fs.readFileSync(documentPath);
        const result = await convert({ arrayBuffer: docBuffer });

        const htmlContent = result.value;
        logger.info('✅ Contenido extraído exitosamente');

        // 3. Crear PDF usando PDFKit
        logger.info('📄 Generando PDF con PDFKit...');

        const pdfDoc = new PDFDocument({
          size: 'A4',
          margin: 40,
          font: 'Helvetica'
        });

        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk) => chunks.push(chunk));

        pdfDoc.on('end', async () => {
          const pdfBuffer = Buffer.concat(chunks);

          // 4. Guardar si se proporciona ruta de salida
          if (outputPath) {
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(outputPath, pdfBuffer);
            logger.info(`💾 PDF guardado en: ${outputPath}`);
          }

          logger.info('✅ PDF generado exitosamente');
          resolve(pdfBuffer);
        });

        pdfDoc.on('error', (error) => {
          logger.error('❌ Error generando PDF:', error);
          reject(error);
        });

        // Convertir HTML a texto plano (PDFKit no soporta HTML directamente)
        // Remover tags HTML
        const plainText = htmlContent
          .replace(/<[^>]*>/g, '') // Remover tags HTML
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .trim();

        // Agregar título y contenido al PDF
        pdfDoc.fontSize(14).font('Helvetica-Bold').text('SENTENCIA', { align: 'center' });
        pdfDoc.moveDown(0.5);

        pdfDoc.fontSize(11).font('Helvetica').text(plainText, {
          align: 'justify',
          width: 500
        });

        pdfDoc.end();

      } catch (error) {
        logger.error('❌ Error en conversión de documento a PDF:', {
          documentPath,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        reject(error);
      }
    });
  }

  /**
   * Convierte un archivo de texto a PDF
   */
  async convertTextToPdf(filePath: string, outputPath?: string): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        logger.info(`🔄 Iniciando conversión de texto a PDF: ${filePath}`);

        if (!fs.existsSync(filePath)) {
          throw new Error(`Archivo no encontrado: ${filePath}`);
        }

        // Leer contenido del archivo
        const textContent = fs.readFileSync(filePath, 'utf-8');

        // Crear PDF
        const pdfDoc = new PDFDocument({
          size: 'A4',
          margin: 40,
          font: 'Helvetica'
        });

        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk) => chunks.push(chunk));

        pdfDoc.on('end', () => {
          const pdfBuffer = Buffer.concat(chunks);

          if (outputPath) {
            const outputDir = path.dirname(outputPath);
            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(outputPath, pdfBuffer);
            logger.info(`💾 PDF guardado en: ${outputPath}`);
          }

          logger.info('✅ PDF generado exitosamente desde texto');
          resolve(pdfBuffer);
        });

        pdfDoc.on('error', (error) => {
          logger.error('❌ Error generando PDF:', error);
          reject(error);
        });

        // Agregar contenido al PDF
        pdfDoc.fontSize(14).font('Helvetica-Bold').text('SENTENCIA', { align: 'center' });
        pdfDoc.moveDown(0.5);

        pdfDoc.fontSize(11).font('Helvetica').text(textContent, {
          align: 'justify',
          width: 500
        });

        pdfDoc.end();

      } catch (error) {
        logger.error('❌ Error en conversión de texto a PDF:', {
          filePath,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        reject(error);
      }
    });
  }

  /**
   * Convierte un documento (DOCX o RTF) a PDF automáticamente
   * @param documentPath - Ruta al documento
   * @returns Buffer del PDF
   */
  async convertToPdf(documentPath: string, outputPath?: string): Promise<Buffer> {
    const ext = path.extname(documentPath).toLowerCase();

    if (ext === '.docx' || ext === '.doc') {
      return this.convertDocxToPdf(documentPath, outputPath);
    } else if (ext === '.rtf' || ext === '.txt') {
      return this.convertTextToPdf(documentPath, outputPath);
    } else {
      throw new Error(`Formato de documento no soportado: ${ext}`);
    }
  }
}

export const documentToPdfService = new DocumentToPdfService();
