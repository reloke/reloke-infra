# --- ÉTAPE 1 : Build du Frontend Angular ---
FROM node:20 AS build-front
WORKDIR /app/frontend
# Utilisation du lockfile pour garantir les versions
COPY front/package*.json ./
RUN npm ci --legacy-peer-deps
COPY front/ .
RUN npm run build -- --configuration production

# --- ÉTAPE 2 : Build du Backend NestJS ---
FROM node:20 AS build-back
WORKDIR /app/backend
# Utilisation du lockfile pour figer Prisma en v5.10.2 (ton local)
COPY back/package*.json ./
RUN npm ci --legacy-peer-deps

COPY back/prisma ./prisma/
# On utilise le binaire local pour ignorer les caprices de npx et Prisma 7
# L'URL fake évite l'erreur P1012 de validation au build
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" ./node_modules/.bin/prisma generate

COPY back/ .
RUN npx nest build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
# Installation de Nginx et des dépendances système nécessaires à Prisma
RUN apt-get update && apt-get install -y nginx openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Récupération des fichiers compilés et du schéma Prisma
COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
COPY --from=build-back /app/backend/prisma ./prisma/

# Installation des dépendances de prod uniquement via le lockfile
RUN npm ci --omit=dev --legacy-peer-deps

# Récupération du Frontend
COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html

# CRUCIAL : Génération du client Prisma pour corriger l'erreur de DTO (Enums undefined)
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" ./node_modules/.bin/prisma generate

# Configuration Nginx
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# Script de démarrage : 
# 1. 'migrate deploy' met à jour la base SQL via le connecteur VPC.
# 2. 'node dist/src/main.js' lance NestJS (attention au dossier /src/).
# 3. Nginx tourne en premier plan pour garder le conteneur vivant.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && (node dist/src/main.js & nginx -g 'daemon off;')"]