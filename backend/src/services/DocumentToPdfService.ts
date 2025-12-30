import { convert } from 'mammoth';
import puppeteer from 'puppeteer';
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
    try {
      logger.info(`🔄 Iniciando conversión de DOCX a PDF: ${documentPath}`);

      // 1. Leer el archivo DOCX
      if (!fs.existsSync(documentPath)) {
        throw new Error(`Archivo no encontrado: ${documentPath}`);
      }

      // 2. Convertir DOCX a HTML usando Mammoth
      logger.info('📄 Extrayendo contenido con Mammoth...');
      const docBuffer = fs.readFileSync(documentPath);
      const result = await convert({ arrayBuffer: docBuffer });
      
      const htmlContent = result.value;
      logger.info('✅ Contenido extraído exitosamente');

      // 3. Crear HTML completo con estilos
      const styledHtml = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sentencia</title>
          <style>
            body {
              font-family: 'Calibri', 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              margin: 40px;
              background: white;
            }
            p {
              text-align: justify;
              margin-bottom: 12px;
              font-size: 12pt;
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 16px;
              margin-bottom: 12px;
              font-weight: bold;
            }
            h1 { font-size: 18pt; }
            h2 { font-size: 14pt; }
            h3 { font-size: 13pt; }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 12px 0;
            }
            th, td {
              border: 1px solid #999;
              padding: 8px;
              text-align: left;
            }
            th {
              background-color: #f0f0f0;
              font-weight: bold;
            }
            .page-break {
              page-break-after: always;
            }
            strong {
              font-weight: bold;
            }
            em {
              font-style: italic;
            }
            u {
              text-decoration: underline;
            }
            @page {
              margin: 20mm;
              size: A4;
            }
            @media print {
              body {
                margin: 0;
              }
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
        </html>
      `;

      // 4. Convertir HTML a PDF usando Puppeteer
      logger.info('🌐 Iniciando navegador para convertir a PDF...');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      try {
        const page = await browser.newPage();
        
        // Establecer contenido HTML
        await page.setContent(styledHtml, {
          waitUntil: 'networkidle0'
        });

        // Generar PDF
        logger.info('📄 Generando PDF...');
        const pdfBuffer = await page.pdf({
          format: 'A4',
          margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm'
          },
          printBackground: true,
          scale: 1
        });

        await page.close();
        logger.info('✅ PDF generado exitosamente');

        // 5. Guardar si se proporciona ruta de salida
        if (outputPath) {
          const outputDir = path.dirname(outputPath);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          fs.writeFileSync(outputPath, pdfBuffer);
          logger.info(`💾 PDF guardado en: ${outputPath}`);
        }

        return pdfBuffer;
      } finally {
        await browser.close();
      }
    } catch (error) {
      logger.error('❌ Error en conversión de documento a PDF:', {
        documentPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Convierte un archivo RTF/TXT a PDF
   * (Similar a DOCX pero requiere procesamiento diferente)
   */
  async convertTextToPdf(filePath: string, outputPath?: string): Promise<Buffer> {
    try {
      logger.info(`🔄 Iniciando conversión de texto a PDF: ${filePath}`);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Archivo no encontrado: ${filePath}`);
      }

      // Leer contenido del archivo
      let textContent = fs.readFileSync(filePath, 'utf-8');

      // Crear HTML desde el texto
      const htmlContent = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sentencia</title>
          <style>
            body {
              font-family: 'Calibri', 'Arial', monospace;
              line-height: 1.5;
              color: #333;
              margin: 40px;
              background: white;
              white-space: pre-wrap;
              word-wrap: break-word;
            }
            @page {
              margin: 20mm;
              size: A4;
            }
          </style>
        </head>
        <body>
          ${textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </body>
        </html>
      `;

      // Convertir a PDF
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, {
          waitUntil: 'networkidle0'
        });

        const pdfBuffer = await page.pdf({
          format: 'A4',
          margin: {
            top: '20mm',
            right: '20mm',
            bottom: '20mm',
            left: '20mm'
          }
        });

        await page.close();

        if (outputPath) {
          const outputDir = path.dirname(outputPath);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          fs.writeFileSync(outputPath, pdfBuffer);
          logger.info(`💾 PDF guardado en: ${outputPath}`);
        }

        logger.info('✅ PDF generado exitosamente desde texto');
        return pdfBuffer;
      } finally {
        await browser.close();
      }
    } catch (error) {
      logger.error('❌ Error en conversión de texto a PDF:', {
        filePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Convierte un documento (DOCX o RTF) a PDF automáticamente
   * @param documentPath - Ruta al documento
   * @returns Buffer del PDF
   */
  async convertToPdf(documentPath: string, outputPath?: string): Promise<Buffer> {
    const ext = path.extname(documentPath).toLowerCase();

    if (ext === '.docx') {
      return this.convertDocxToPdf(documentPath, outputPath);
    } else if (ext === '.rtf' || ext === '.txt') {
      return this.convertTextToPdf(documentPath, outputPath);
    } else {
      throw new Error(`Formato de documento no soportado: ${ext}`);
    }
  }
}

export const documentToPdfService = new DocumentToPdfService();
