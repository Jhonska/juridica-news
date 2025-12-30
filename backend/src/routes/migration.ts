import { Router } from 'express';
import { authMiddleware } from '@/middleware/auth';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

const router = Router();
const gunzip = promisify(zlib.gunzip);

// Upload compressed database file
router.post('/upload-database', authMiddleware, async (req, res) => {
  try {
    const { compressedData, filename } = req.body;

    console.log(`[MIGRATION] Receiving ${filename}...`);

    // Decode base64 and decompress
    const compressedBuffer = Buffer.from(compressedData, 'base64');
    console.log(`[MIGRATION] Compressed size: ${(compressedBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    const decompressed = await gunzip(compressedBuffer);
    console.log(`[MIGRATION] Decompressed size: ${(decompressed.length / 1024 / 1024).toFixed(2)} MB`);

    // Write to database location
    const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
    fs.writeFileSync(dbPath, decompressed);

    console.log(`[MIGRATION] ✅ Database written to ${dbPath}`);

    return res.json({
      success: true,
      message: 'Database uploaded and decompressed successfully',
      sizeCompressed: compressedBuffer.length,
      sizeDecompressed: decompressed.length
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
