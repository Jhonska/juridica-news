#!/bin/bash

# Script de Deploy en Railway
echo "🚀 Iniciando deployment en Railway..."

# 1. Login en Railway (abrirá navegador)
echo "📝 Paso 1: Autenticando en Railway..."
railway login

# 2. Crear proyecto
echo "📝 Paso 2: Creando proyecto en Railway..."
railway init

# 3. Linkear proyecto
echo "📝 Paso 3: Linkeando proyecto..."
railway link

# 4. Configurar variables de entorno
echo "📝 Paso 4: Configurando variables de entorno..."
railway variable set NODE_ENV=production
railway variable set PORT=3001
railway variable set DATABASE_URL="file:/app/backend/prisma/dev.db"
railway variable set JWT_SECRET="149ac487ccdb54d81dca7cd8a9b8d10dbd5ed233f6d49ccd6b76d60f5e8c55a5"
railway variable set JWT_REFRESH_SECRET="d24ca86bde55bb0d56995103ee74624357239f2e88b34966afc10eb2e291ee84"
railway variable set JWT_EXPIRES_IN="30m"
railway variable set JWT_REFRESH_EXPIRES_IN="7d"
railway variable set CORS_ORIGIN="*"
railway variable set RATE_LIMIT_WINDOW_MS="60000"
railway variable set RATE_LIMIT_MAX_REQUESTS="1000"
railway variable set OPENAI_API_KEY="sk-proj-YOUR_REAL_KEY_HERE"
railway variable set GEMINI_API_KEY="AIza-YOUR_REAL_KEY_HERE"
railway variable set REDIS_URL="redis://localhost:6379"

# 5. Crear volúmenes
echo "📝 Paso 5: Creando volúmenes persistentes..."
railway volume create juridica-database
railway volume mount juridica-database /app/backend/prisma
railway volume create juridica-storage
railway volume mount juridica-storage /app/backend/storage

# 6. Deploy
echo "📝 Paso 6: Haciendo deploy..."
railway up

# 7. Obtener URL
echo "📝 Paso 7: Obteniendo URL pública..."
railway domain

echo "✅ ¡Deployment completado!"
