#!/bin/sh
set -e

echo "🚀 Starting application..."

# 1. Migrations Prisma (avant tout)
echo "📦 Running Prisma migrations..."
npx prisma@5.22.0 migrate deploy

# 2. Scripts SQL PostGIS
echo "🗺️ Running spatial scripts..."
npx prisma@5.22.0 db execute --file ./sql/spatial/afterMigration.sql || echo "Spatial script skipped or already applied"

# 3. Seed (optionnel - à ne faire qu'une fois normalement)
echo "🌱 Running seed..."
npx prisma@5.22.0 db seed || echo "Seed skipped or already applied"

# 4. Démarrer NestJS en BACKGROUND et attendre qu'il soit prêt
echo "🔧 Starting NestJS backend..."
PORT=3000 node dist/src/main.js &
NEST_PID=$!

# 5. Attendre que NestJS réponde sur le port 3000
echo "⏳ Waiting for NestJS to be ready..."
MAX_WAIT=60
WAITED=0
until nc -z 127.0.0.1 3000 2>/dev/null; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "❌ NestJS failed to start within ${MAX_WAIT}s"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
  echo "   Waiting... (${WAITED}s)"
done
echo "✅ NestJS is ready!"

# 6. Démarrer Nginx en FOREGROUND (process principal)
echo "🌐 Starting Nginx..."
nginx -g 'daemon off;'