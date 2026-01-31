#!/bin/sh
set -e

# Charger le fichier .env monté depuis Secret Manager
if [ -f /app/.env ]; then
  echo "📄 Loading environment from /app/.env"
  set -a
  . /app/.env
  set +a
fi

echo "🚀 Starting application..."

# Migrations seulement si variable RUN_MIGRATIONS=true
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "📦 Running Prisma migrations..."
  echo "Database URL configured: $(echo $DATABASE_URL | cut -c1-50)..."
  npx prisma@5.22.0 migrate deploy

  echo "🗺️ Running spatial scripts..."
  npx prisma@5.22.0 db execute --file ./sql/spatial/afterMigration.sql || echo "Spatial script skipped"

  echo "🌱 Running seed..."
  npx prisma@5.22.0 db seed || echo "Seed skipped"
fi

# Démarrer NestJS
echo "🔧 Starting NestJS backend..."
PORT=3000 node dist/src/main.js &
NEST_PID=$!

# Attendre que NestJS soit prêt
echo "⏳ Waiting for NestJS to be ready..."
MAX_WAIT=120
WAITED=0
until nc -z 127.0.0.1 3000 2>/dev/null; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "❌ NestJS failed to start within ${MAX_WAIT}s"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
echo "✅ NestJS is ready!"

# Démarrer Nginx
echo "🌐 Starting Nginx..."
nginx -g 'daemon off;'