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

# On utilise npx avec la version précise pour éviter tout conflit
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" npx prisma@5.10.2 generate

COPY back/ .
RUN npx nest build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
RUN apt-get update && apt-get install -y nginx openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
COPY --from=build-back /app/backend/prisma ./prisma/

# On installe les dépendances. Si prisma est en devDependency, 
# npx ira le chercher dans la version spécifiée après.
RUN npm install --omit=dev --legacy-peer-deps

# On génère le client avec la version exacte 5.10.2
RUN DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" npx prisma@5.10.2 generate

COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# On utilise la version précise pour le deploy également
CMD ["sh", "-c", "npx prisma@5.10.2 migrate deploy && (node dist/src/main.js & nginx -g 'daemon off;')"]