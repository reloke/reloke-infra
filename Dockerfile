# --- ÉTAPE 1 : Build du Frontend Angular ---
FROM node:20 AS build-front
WORKDIR /app/frontend
COPY front/package*.json ./
RUN npm install
COPY front/ .
RUN npm run build -- --configuration production

# --- ÉTAPE 2 : Build du Backend NestJS ---
FROM node:20 AS build-back
WORKDIR /app/backend
COPY back/package*.json ./
RUN npm install
COPY back/ .
RUN npm run build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Copier le back
COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
RUN npm install --only=production

# Copier le front vers Nginx
COPY --from=build-front /app/frontend/dist/browser /usr/share/nginx/html

# Config Nginx et Port
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# Script de démarrage
CMD ["sh", "-c", "node dist/main.js & nginx -g 'daemon off;'"]