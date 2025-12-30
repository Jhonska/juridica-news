import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

const router = Router();
const gunzip = promisify(zlib.gunzip);

// Upload compressed database file in chunks
router.post('/upload-database-chunk', authMiddleware, async (req, res) => {
  try {
    const { compressedChunk, chunkIndex, totalChunks, filename } = req.body;

    const tempDir = path.join(process.cwd(), '.migration-temp');
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(`[MIGRATION] Receiving chunk ${chunkIndex + 1}/${totalChunks} for ${filename}`);

    // Decode base64 and save chunk
    const chunkBuffer = Buffer.from(compressedChunk, 'base64');
    const chunkPath = path.join(tempDir, `${filename}.chunk.${chunkIndex}`);
    fs.writeFileSync(chunkPath, chunkBuffer);

    console.log(`[MIGRATION] Chunk ${chunkIndex + 1} saved (${(chunkBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // If last chunk, combine all and decompress
    if (chunkIndex === totalChunks - 1) {
      console.log(`[MIGRATION] Last chunk received, combining and decompressing...`);

      const chunks = [];
      for (let i = 0; i < totalChunks; i++) {
        const data = fs.readFileSync(path.join(tempDir, `${filename}.chunk.${i}`));
        chunks.push(data);
      }

      const compressedBuffer = Buffer.concat(chunks);
      console.log(`[MIGRATION] Total compressed size: ${(compressedBuffer.length / 1024 / 1024).toFixed(2)} MB`);

      const decompressed = await gunzip(compressedBuffer);
      console.log(`[MIGRATION] Decompressed size: ${(decompressed.length / 1024 / 1024).toFixed(2)} MB`);

      // Write to database location
      const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
      fs.writeFileSync(dbPath, decompressed);

      // Cleanup temp files
      fs.rmSync(tempDir, { recursive: true, force: true });

      console.log(`[MIGRATION] ✅ Database written to ${dbPath}`);

      return res.json({
        success: true,
        message: 'Database upload complete and decompressed successfully',
        sizeCompressed: compressedBuffer.length,
        sizeDecompressed: decompressed.length
      });
    }

    return res.json({
      success: true,
      message: `Chunk ${chunkIndex + 1}/${totalChunks} received`,
      chunkIndex
    });
  } catch (error: any) {
    console.error(`[MIGRATION] ❌ Error:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Upload compressed storage files (images/documents)
router.post('/upload-storage', authMiddleware, async (req, res) => {
  try {
    const { compressedData, targetPath } = req.body;

    console.log(`[MIGRATION] Receiving storage file: ${targetPath}...`);

    // Decode and decompress
    const compressedBuffer = Buffer.from(compressedData, 'base64');
    const decompressed = await gunzip(compressedBuffer);

    // Write to storage location
    const fullPath = path.join(process.cwd(), targetPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, decompressed);

    console.log(`[MIGRATION] ✅ File written to ${fullPath}`);

    return res.json({
      success: true,
      message: 'Storage file uploaded successfully',
      path: targetPath
    });
  } catch (error: any) {
    console.error(`[MIGRATION] ❌ Error:`, error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
