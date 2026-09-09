FROM node:22-bookworm-slim

# Client PostgreSQL depuis le dépôt officiel PGDG.
# Le paquet de Debian bookworm est figé en 15, or pg_dump REFUSE de dumper un
# serveur plus récent que lui ("server version mismatch"). Installer la dernière
# version majeure permet de sauvegarder tous les serveurs jusqu'à celle-ci.
ARG PG_MAJOR=18
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}" openssh-client && \
    apt-get purge -y curl gnupg && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

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

# Répertoire des sauvegardes locales.
# Sans cette variable, le code résout "./backups" depuis le WORKDIR (/app) et
# écrit dans /app/backups : le volume monté sur /backups serait ignoré et les
# copies locales perdues à chaque recréation du conteneur.
RUN mkdir -p /backups
ENV SHUTTLE_LOCAL_BACKUP_DIR=/backups

# Point d'entrée (chemin absolu + tolérance à la forme `shuttle <cmd>`)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    printf '#!/bin/sh\nexec node /app/dist/index.js "$@"\n' > /usr/local/bin/shuttle && \
    chmod +x /usr/local/bin/shuttle

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["--help"]

