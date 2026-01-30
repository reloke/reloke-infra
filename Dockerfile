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
# Utilisation de --skipLibCheck pour ignorer les erreurs de types Stripe/Auth pendant le build
RUN npx nest build -- --skipLibCheck

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
# Basé sur ton build local réussi : le chemin est /app/frontend/dist/Reloke
COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html

# Configuration Nginx
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# Démarrage : Migration de la DB + NestJS + Nginx
# Rappel : DATABASE_URL doit être configurée dans les secrets de Cloud Run
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js & nginx -g 'daemon off;'"]