# --- ÉTAPE 1 : Build du Frontend Angular ---
FROM node:20 AS build-front
WORKDIR /app/frontend
COPY front/package*.json ./
RUN npm install --legacy-peer-deps
COPY front/ .
RUN npm run build -- --configuration production

# --- ÉTAPE 2 : Build du Backend NestJS ---
FROM node:20 AS build-back
WORKDIR /app/backend
COPY back/package*.json ./
RUN npm install --legacy-peer-deps
COPY back/prisma ./prisma/

# On fixe l'URL bidon via ENV pour éviter l'erreur de "path undefined"
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" npx prisma@5.22.0 generate
#ENV DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" RUN npx prisma@5.22.0 generate

COPY back/ .
RUN npx nest build


# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
RUN apt-get update && apt-get install -y nginx openssl libssl-dev netcat-openbsd && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
COPY --from=build-back /app/backend/prisma ./prisma/
COPY --from=build-back /app/backend/sql ./sql

RUN npm install --omit=dev --legacy-peer-deps

# Generate avec variable temporaire (ne persiste pas dans l'image)
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" npx prisma@5.22.0 generate
#ENV DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" RUN npx prisma@5.22.0 generate ENV DATABASE_URL=""

COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
# Copier le script de démarrage
COPY startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

EXPOSE 8080

# Utiliser le script
CMD ["/app/startup.sh"]