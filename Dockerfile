# --- ÉTAPE 1 : Build du Frontend Angular ---
FROM node:20 AS build-front
WORKDIR /app/frontend
COPY front/package*.json ./
# Retour à install car le lockfile est absent
RUN npm install --legacy-peer-deps
COPY front/ .
RUN npm run build -- --configuration production

# --- ÉTAPE 2 : Build du Backend NestJS ---
FROM node:20 AS build-back
WORKDIR /app/backend
COPY back/package*.json ./
RUN npm install --legacy-peer-deps

COPY back/prisma ./prisma/
# On force l'utilisation du binaire local installé par npm install
# L'URL fake empêche Prisma de valider la DB pendant le build
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" ./node_modules/.bin/prisma generate

COPY back/ .
RUN npx nest build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
RUN apt-get update && apt-get install -y nginx openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
COPY --from=build-back /app/backend/prisma ./prisma/

# Installation prod
RUN npm install --omit=dev --legacy-peer-deps

# On régénère le client dans l'image finale pour les Enums
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" ./node_modules/.bin/prisma generate

COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# On lance la migration et le serveur
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && (node dist/src/main.js & nginx -g 'daemon off;')"]