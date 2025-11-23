# Shuttle

**Shuttle** est un outil de backup PostgreSQL qui permet d'exporter vos bases de données et de les transférer automatiquement vers un serveur distant via SSH.

## Caractéristiques

- **Configuration sans secrets** : Le fichier `.yml` ne contient aucune information sensible
- **Séparation stricte** : Tous les secrets sont dans `.env` ou les variables d'environnement
- **Support Docker** : Fonctionne parfaitement avec des bases de données dockerisées
- **Planification flexible** : Utilise des expressions cron pour planifier les backups
- **Rétention automatique** : Gère automatiquement la rétention des backups (local + distant)
- **Types de dumps** : Support des dumps complets ou par tables spécifiques
- **Compression** : Compression optionnelle des dumps
- **CLI complète** : Commandes pour init, validate, run, daemon, ls

## Installation

### Via npm/pnpm (global)

```bash
npm install -g shuttle
# ou
pnpm add -g shuttle
```

### Via Docker

```bash
docker build -t shuttle .
```

## Configuration

### 1. Initialiser la configuration

```bash
shuttle init
```

Cela crée deux fichiers :
- `shuttle.yml` : Configuration fonctionnelle (sans secrets)
- `.env.example` : Template pour les variables d'environnement

### 2. Configurer les secrets

Copiez `.env.example` vers `.env` et remplissez les valeurs :

```bash
cp .env.example .env
```

### 3. Structure du fichier `.yml`

Le fichier `.yml` (ou `.yaml`, `.json`, `.apo`) décrit la configuration fonctionnelle :

```json
{
  "version": 1,
  "shuttle": {
    "name": "my-prod-shuttle",
    "timezone": "Europe/Paris",
    "connections": {
      "source": "prod_main",
      "target": "prod_backup"
    },
    "jobs": [
      {
        "name": "full-nightly",
        "type": "full",
        "cron": "0 3 * * *",
        "format": "custom",
        "compress": true,
        "keepLast": 7
      },
      {
        "name": "tables-frequent",
        "type": "tables",
        "cron": "*/30 * * * *",
        "tables": [
          "public.users",
          "public.orders"
        ],
        "format": "plain",
        "compress": true,
        "keepLast": 48
      }
    ]
  }
}
```

**Champs du job :**
- `name` : Nom unique du job
- `type` : `"full"` (dump complet) ou `"tables"` (tables spécifiques)
- `cron` : Expression cron (ex: `"0 3 * * *"` = tous les jours à 3h)
- `format` : `"plain"` (SQL) ou `"custom"` (format PostgreSQL)
- `compress` : `true` pour compresser le dump
- `keepLast` : Nombre de backups à conserver (local + distant)
- `tables` : (optionnel) Liste des tables pour `type: "tables"`
- `timeout` : (optionnel) Timeout en millisecondes pour pg_dump

### 4. Variables d'environnement

Les variables d'environnement suivent la convention :
`SHUTTLE_{CONNECTION_ID}_{TYPE}_{KEY}`

**Pour la connexion source (DB) :**
```bash
SHUTTLE_PROD_MAIN_DB_HOST=postgres
SHUTTLE_PROD_MAIN_DB_PORT=5432
SHUTTLE_PROD_MAIN_DB_NAME=my_app
SHUTTLE_PROD_MAIN_DB_USER=shuttle
SHUTTLE_PROD_MAIN_DB_PASSWORD=supersecret
```

**Pour la connexion target (SSH) :**
```bash
SHUTTLE_PROD_BACKUP_SSH_HOST=backup.example.com
SHUTTLE_PROD_BACKUP_SSH_PORT=22
SHUTTLE_PROD_BACKUP_SSH_USER=backup
SHUTTLE_PROD_BACKUP_SSH_KEY_PATH=/path/to/id_ed25519
SHUTTLE_PROD_BACKUP_SSH_KEY_PASSPHRASE=  # Optionnel
SHUTTLE_PROD_BACKUP_BASE_PATH=/backups/my_app
```

**Optionnel :**
```bash
SHUTTLE_LOCAL_BACKUP_DIR=./backups  # Répertoire local pour les dumps
```

## Utilisation

### Valider la configuration

```bash
shuttle validate -c shuttle.yml
```

Vérifie que :
- Le fichier de configuration est valide
- Toutes les variables d'environnement requises sont présentes

### Exécuter les jobs une fois

```bash
shuttle run -c shuttle.yml
```

Exécute tous les jobs immédiatement, sans attendre le cron.

### Lancer en mode daemon

```bash
shuttle daemon -c shuttle.yml
```

Démarre le daemon qui planifie les jobs selon leurs expressions cron. Le processus reste actif jusqu'à interruption (Ctrl+C).

### Lister les jobs

```bash
shuttle ls -c shuttle.yml
```

Affiche la liste de tous les jobs configurés.

## Utilisation avec Docker

### Cas d'usage : Base de données dockerisée

Shuttle fonctionne parfaitement avec des bases de données dans Docker.

#### 1. Créer un réseau Docker

```bash
docker network create shuttle-net
```

#### 2. Lancer votre base de données PostgreSQL

```bash
docker run -d \
  --name postgres \
  --network shuttle-net \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=my_app \
  postgres:15
```

#### 3. Préparer la configuration

Créez un répertoire `config/` avec :
- `shuttle.yml` (sans secrets)
- `.env` (avec tous les secrets)

Dans `.env`, utilisez le nom du service Docker comme host :
```bash
SHUTTLE_PROD_MAIN_DB_HOST=postgres  # Nom du service Docker
SHUTTLE_PROD_MAIN_DB_PORT=5432
# ...
```

#### 4. Lancer Shuttle en Docker

```bash
docker run -d \
  --name shuttle \
  --network shuttle-net \
  -v $(pwd)/config:/config \
  -v $(pwd)/backups:/backups \
  --env-file ./config/.env \
  shuttle \
  shuttle daemon -c /config/shuttle.yml
```

**Explication :**
- `--network shuttle-net` : Même réseau que la DB
- `-v $(pwd)/config:/config` : Montage du répertoire de config
- `-v $(pwd)/backups:/backups` : Montage du répertoire de backups
- `--env-file ./config/.env` : Chargement des variables d'environnement

#### 5. Avec docker-compose

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: my_app
    networks:
      - shuttle-net

  shuttle:
    build: .
    volumes:
      - ./config:/config
      - ./backups:/backups
    env_file:
      - ./config/.env
    command: shuttle daemon -c /config/shuttle.yml
    depends_on:
      - postgres
    networks:
      - shuttle-net

networks:
  shuttle-net:
    driver: bridge
```

## Structure des fichiers de backup

Les backups sont organisés comme suit :

**Local :**
```
./backups/
  ├── full-nightly_2024-01-15T03-00-00.dump.gz
  ├── full-nightly_2024-01-16T03-00-00.dump.gz
  └── tables-frequent_2024-01-15T10-30-00.sql.gz
```

**Distant (via SSH) :**
```
/backups/my_app/
  ├── full-nightly/
  │   └── 2024-01-15/
  │       └── full-nightly_2024-01-15T03-00-00.dump.gz
  └── tables-frequent/
      └── 2024-01-15/
          ├── tables-frequent_2024-01-15T10-00-00.sql.gz
          └── tables-frequent_2024-01-15T10-30-00.sql.gz
```

## Sécurité

### Bonnes pratiques

1. **Ne jamais commiter `.env`** : Ajoutez `.env` à `.gitignore`
2. **Versionner `.yml`** : Le fichier `.yml` ne contient pas de secrets, il peut être versionné
3. **Permissions SSH** : Utilisez des clés SSH avec des permissions restrictives (`chmod 600`)
4. **Variables d'environnement en production** : En Docker, utilisez `--env-file` ou des secrets Docker

### Logs

Shuttle ne log jamais :
- Les mots de passe
- Les clés privées SSH
- Les passphrases

Seuls les hostnames et ports (non sensibles) peuvent apparaître dans les logs.

## Développement

### Prérequis

- Node.js >= 18
- PostgreSQL client (`pg_dump` dans le PATH)
- TypeScript

### Installation des dépendances

```bash
npm install
```

### Build

```bash
npm run build
```

### Développement avec hot-reload

```bash
npm run dev
```

### Lint

```bash
npm run lint
```

## Architecture

```
shuttle/
├── src/
│   ├── index.ts              # Point d'entrée CLI
│   ├── cli/
│   │   ├── commander.ts      # Définition des commandes
│   │   └── commands/         # Implémentation des commandes
│   ├── config/
│   │   ├── schema.ts         # Schéma Zod pour la config
│   │   ├── loader.ts         # Chargement .yml + .env
│   │   └── types.ts          # Types TypeScript
│   ├── core/
│   │   ├── jobs.ts           # Exécution des jobs
│   │   └── scheduler.ts      # Planification avec node-cron
│   ├── services/
│   │   ├── pgDump.ts         # Wrapper pg_dump
│   │   ├── sshTransfer.ts    # Transfert SFTP
│   │   └── retention.ts      # Gestion de la rétention
│   └── utils/
│       ├── logger.ts         # Logging avec pino
│       ├── env.ts            # Helpers pour env vars
│       └── paths.ts          # Gestion des chemins
├── examples/                 # Exemples de configuration
├── Dockerfile
└── README.md
```

## License

MIT
