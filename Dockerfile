# --- ÉTAPE 1 : Build du Frontend Angular ---
FROM node:20 AS build-front
WORKDIR /app/frontend

# Installation avec gestion des conflits de dépendances
COPY front/package*.json ./
RUN npm install --legacy-peer-deps

# Copie du code et build
COPY front/ .
RUN npm run build -- --configuration production

# --- ÉTAPE 2 : Build du Backend NestJS ---
FROM node:20 AS build-back
WORKDIR /app/backend

# 1. Copier package.json et installer les dépendances
COPY back/package*.json ./
RUN npm install --legacy-peer-deps

# 2. Copier le schéma Prisma (CRUCIAL pour générer les types TS)
COPY back/prisma ./prisma/
RUN npx prisma generate

# 3. Copier le reste du code et compiler NestJS
COPY back/ .
RUN npm run build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
# Installation de Nginx
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Récupération du Backend
COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
COPY --from=build-back /app/backend/prisma ./prisma/

# Installation des dépendances de prod uniquement
RUN npm install --only=production --legacy-peer-deps

# Récupération du Frontend
# Note : vérifie bien si ton Angular 17+ génère dans dist/browser ou dist/[nom-projet]/browser
COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html

# Configuration Nginx
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# Démarrage : Migration de la DB (optionnel au runtime) + NestJS + Nginx
# Note : npx prisma migrate deploy nécessite que DATABASE_URL soit définie dans Cloud Run
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js & nginx -g 'daemon off;'"]