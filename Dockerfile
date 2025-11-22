FROM node:22-bookworm-slim

# Installer postgresql-client et openssh-client
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    postgresql-client \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration du package
COPY package.json package-lock.json* ./

# Installer toutes les dépendances (y compris dev pour le build)
RUN npm ci

# Copier le code source
COPY . .

# Builder TypeScript
RUN npm run build

# Supprimer les devDependencies pour réduire la taille de l'image
RUN npm prune --production

# Créer le répertoire pour les backups locaux
RUN mkdir -p /backups

# Point d'entrée
ENTRYPOINT ["node", "dist/index.js"]

