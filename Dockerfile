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
# Génération du client Prisma avant le build
RUN npx prisma generate
COPY back/ .
# Suppression du "|| exit 0" : si le build échoue, on veut que le build GCP s'arrête !
RUN npx nest build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
# Installation de Nginx et des dépendances système pour Prisma
RUN apt-get update && apt-get install -y nginx openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Récupération du Backend compilé
COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
COPY --from=build-back /app/backend/prisma ./prisma/

# Installation des dépendances de prod uniquement
RUN npm install --only=production --legacy-peer-deps

# Récupération du Frontend
COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html

# Configuration Nginx
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# On utilise ';' au lieu de '&&' pour que Nginx se lance MÊME SI prisma échoue
#CMD ["sh", "-c", "npx prisma migrate deploy ; (node dist/main.js & nginx -g 'daemon off;')"]
#CMD ["sh", "-c", "node dist/main.js & nginx -g 'daemon off;' & npx prisma migrate deploy"]
CMD ["sh", "-c", "npx prisma migrate deploy ; (node dist/src/main.js & nginx -g 'daemon off;')"]