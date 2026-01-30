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
# Utilisation du dossier "back" selon ton arborescence
COPY back/package*.json ./
RUN npm install
COPY back/ .
RUN npm run build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
# Installation de Nginx pour servir le front
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# On récupère le code compilé du back (dist) à la racine de /app
COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./

# Installation des dépendances de prod à la racine /app
RUN npm install --only=production

# On récupère le build du front vers le dossier standard Nginx
# Attention : vérifie si Angular produit "dist/browser" ou juste "dist"
COPY --from=build-front /app/frontend/dist/browser /usr/share/nginx/html

# Injection de la config Nginx et ouverture du port Cloud Run
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# Démarrage simultané de NestJS (en tâche de fond) et Nginx
CMD ["sh", "-c", "node dist/main.js & nginx -g 'daemon off;'"]