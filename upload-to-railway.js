const fs = require('fs');
const zlib = require('zlib');
const axios = require('axios');
const path = require('path');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

const RAILWAY_URL = 'https://juridica-news-production.up.railway.app';
const TOKEN = process.env.RAILWAY_AUTH_TOKEN; // Must be set before running

if (!TOKEN) {
  console.error('❌ ERROR: RAILWAY_AUTH_TOKEN environment variable not set');
  console.error('Set it with: export RAILWAY_AUTH_TOKEN="your_token_here"');
  process.exit(1);
}

async function uploadDatabase() {
  console.log('📦 Step 1: Compressing database...');

  const dbPath = './backend/prisma/dev.db';
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database not found at ${dbPath}`);
    process.exit(1);
  }

  const dbBuffer = fs.readFileSync(dbPath);
  console.log(`   Original size: ${(dbBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  // Compress with gzip level 9 (maximum compression)
  const compressed = await gzip(dbBuffer, { level: 9 });
  console.log(`   Compressed size: ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Compression ratio: ${((1 - compressed.length / dbBuffer.length) * 100).toFixed(1)}%`);

  console.log('\n📤 Step 2: Uploading to Railway in chunks...');

  // Send in 10MB chunks to avoid request size limits
  const CHUNK_SIZE = 10 * 1024 * 1024;
  const totalChunks = Math.ceil(compressed.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, compressed.length);
    const chunk = compressed.slice(start, end);

    console.log(`   📤 Uploading chunk ${i + 1}/${totalChunks} (${(chunk.length / 1024 / 1024).toFixed(2)} MB)...`);

    try {
      const response = await axios.post(
        `${RAILWAY_URL}/api/migration/upload-database-chunk`,
        {
          compressedChunk: chunk.toString('base64'),
          chunkIndex: i,
          totalChunks,
          filename: 'dev.db'
        },
        {
          headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json'
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 60000 // 1 minute per chunk
        }
      );

      if (i === totalChunks - 1) {
        console.log('✅ Database upload complete!');
        console.log(`   Server response:`, JSON.stringify(response.data, null, 2));
      } else {
        console.log(`      ✅ Chunk ${i + 1} received`);
      }
    } catch (error) {
      console.error(`❌ Chunk ${i + 1} upload failed:`, error.response?.data || error.message);
      throw error;
    }
  }
}

async function uploadStorageFiles() {
  console.log('\n📦 Step 3: Uploading storage files...');

  const storageDir = './backend/storage';
  const subdirs = ['images', 'documents'];
  let totalUploaded = 0;

  for (const subdir of subdirs) {
    const dirPath = path.join(storageDir, subdir);
    if (!fs.existsSync(dirPath)) {
      console.log(`   ⚠️  ${subdir} directory not found, skipping...`);
      continue;
    }

    const files = fs.readdirSync(dirPath).filter(f => {
      const stat = fs.statSync(path.join(dirPath, f));
      return stat.isFile();
    });

    console.log(`\n   Processing ${files.length} files from ${subdir}/...`);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);

      console.log(`   📤 Uploading ${subdir}/${file} (${(stat.size / 1024).toFixed(1)} KB)...`);

      try {
        const fileBuffer = fs.readFileSync(filePath);
        const compressed = await gzip(fileBuffer, { level: 9 });

        await axios.post(
          `${RAILWAY_URL}/api/migration/upload-storage`,
          {
            compressedData: compressed.toString('base64'),
            targetPath: `storage/${subdir}/${file}`
          },
          {
            headers: {
              'Authorization': `Bearer ${TOKEN}`,
              'Content-Type': 'application/json'
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000 // 1 minute per file
          }
        );

        console.log(`      ✅ Uploaded`);
        totalUploaded++;
      } catch (error) {
        console.error(`      ❌ Upload failed:`, error.response?.data || error.message);
        throw error;
      }
    }
  }

  console.log(`\n✅ All ${totalUploaded} storage files uploaded!`);
}

async function main() {
  try {
    console.log('🚀 Starting migration to Railway...\n');
    console.log(`Target: ${RAILWAY_URL}`);
    console.log(`Token: ${TOKEN.substring(0, 10)}...${TOKEN.substring(TOKEN.length - 10)}\n`);

    await uploadDatabase();
    await uploadStorageFiles();

    console.log('\n🎉 Migration complete!');
    console.log('✅ Portal should now be populated with articles and images');
    console.log('ℹ️  Remember to remove the migration endpoint after verification');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

main();
