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
ENV DATABASE_URL="postgresql://fake:fake@localhost:5432/fake"
RUN npx prisma@5.22.0 generate

COPY back/ .
RUN npx nest build

# --- ÉTAPE 3 : Image Finale (Production) ---
FROM node:20-slim
RUN apt-get update && apt-get install -y nginx openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build-back /app/backend/dist ./dist
COPY --from=build-back /app/backend/package*.json ./
COPY --from=build-back /app/backend/prisma ./prisma/
COPY --from=build-back /app/backend/sql ./sql

RUN npm install --omit=dev --legacy-peer-deps

# On regénère ici aussi avec la version 5.22.0
ENV DATABASE_URL="postgresql://fake:fake@localhost:5432/fake"
RUN npx prisma@5.22.0 generate

COPY --from=build-front /app/frontend/dist/Reloke /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 8080

# On utilise la même version pour le déploiement
#CMD ["sh", "-c", "npx prisma@5.22.0 migrate deploy && (node dist/src/main.js & nginx -g 'daemon off;')"]
#CMD ["sh", "-c", "npx prisma@5.22.0 migrate deploy ; (node dist/src/main.js & nginx -g 'daemon off;')"]
#CMD ["sh", "-c", "npx prisma@5.22.0 migrate deploy && (nginx -g 'daemon off;' & PORT=3000 node dist/src/main.js)"]
#CMD ["sh", "-c", "npm run deploy && (nginx -g 'daemon off;' & PORT=3000 node dist/src/main.js)"]
#CMD ["sh", "-c", "npx prisma@5.22.0 migrate deploy && npx prisma@5.22.0 db seed && (nginx -g 'daemon off;' & PORT=3000 node dist/src/main.js)"]
# CMD UNIQUE : 
# 1. Migrate deploy (Tables)
# 2. db:spatial (Scripts SQL PostGIS)
# 3. db seed (Admin)
# 4. Lancement Nginx + NestJS sur port 3000
#CMD ["sh", "-c", "npx prisma@5.22.0 migrate deploy && npx prisma@5.22.0 db execute --file ./sql/spatial/afterMigration.sql && npx prisma@5.22.0 db seed && (nginx -g 'daemon off;' & PORT=3000 node dist/src/main.js)"]
CMD ["sh", "-c", "nginx -g 'daemon off;' & (npx prisma@5.22.0 migrate deploy && npx prisma@5.22.0 db execute --file ./sql/spatial/afterMigration.sql && npx prisma@5.22.0 db seed && PORT=3000 node dist/src/main.js)"]