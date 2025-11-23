# Shuttle

**Shuttle** is a PostgreSQL backup tool that exports your databases and automatically transfers them to a remote server via SSH.

- **npm package**: [`@claquettes/shuttle`](https://www.npmjs.com/package/@claquettes/shuttle)
- **Docker image**: [`claquettes/shuttle`](https://hub.docker.com/r/claquettes/shuttle)
- **GitHub**: [claquettes/shuttle](https://github.com/claquettes/shuttle)

## Features

- **Simple configuration**: Single YAML file with PostgreSQL URL support
- **Flexible**: Secrets can be in the YAML file or via environment variables (${VAR})
- **Docker support**: Works seamlessly with containerized databases
- **Flexible scheduling**: Uses cron expressions to schedule backups
- **Automatic retention**: Manages backup retention automatically (local + remote)
- **Dump types**: Supports full dumps or specific tables
- **Compression**: Optional dump compression
- **Complete CLI**: Commands for init, validate, run, daemon, ls

## Installation

### Option 1: npm/pnpm (CLI - Recommended for local use)

Install globally to use Shuttle as a CLI tool:

```bash
npm install -g @claquettes/shuttle
# or
pnpm add -g @claquettes/shuttle
```

After installation, use Shuttle commands directly:
```bash
shuttle init
shuttle validate -c shuttle.yml
shuttle run -c shuttle.yml
```

### Option 2: Docker (Recommended for production)

#### Using pre-built image from Docker Hub

```bash
# Pull the latest image
docker pull claquettes/shuttle:latest

# Or a specific version
docker pull claquettes/shuttle:1.0.0
```

#### Using in docker-compose

```yaml
services:
  shuttle:
    # Use pre-built image (recommended)
    image: claquettes/shuttle:latest
    
    # Or use GitHub Container Registry
    # image: ghcr.io/claquettes/shuttle:latest
    
    volumes:
      - ./shuttle.yml:/config/shuttle.yml:ro
      - ./ssh_key:/config/ssh_key:ro
      - ./backups:/backups
    command: shuttle daemon -c /config/shuttle.yml
```

#### Building from source (optional)

If you prefer to build from source:

```bash
docker build -f Dockerfile.production -t shuttle:latest .
```

Or in docker-compose (build from source):

```yaml
services:
  shuttle:
    build:
      context: https://github.com/claquettes/shuttle.git
      dockerfile: Dockerfile.production
```

**Note:** For production, we recommend using the pre-built image `claquettes/shuttle:latest` from Docker Hub instead of building from source.

## Configuration

### 1. Initialize configuration

```bash
shuttle init
```

This creates a `shuttle.yml` file with a configuration template.

### 2. Configure your backup

Edit `shuttle.yml` and fill in:
- Your PostgreSQL database URL (or separate details)
- Your SSH backup server information
- Place your SSH private key at the path specified in `key_path`

### 3. Configuration file structure

The `.yml` (or `.yaml`, `.json`, `.apo`) file describes the functional configuration:

```yaml
version: 1
shuttle:
  name: my-prod-shuttle
  timezone: Europe/Paris
  
  # Source: PostgreSQL database
  # Option 1: Full URL (recommended)
  source:
    url: postgresql://user:password@host:5432/database
  # Option 2: Separate details
  # source:
  #   host: postgres
  #   port: 5432
  #   database: mydb
  #   user: myuser
  #   password: mypassword
  
  # Target: Backup server (SSH/SFTP)
  target:
    host: backup.example.com
    port: 22
    user: backup
    key_path: ./ssh_key
    base_path: /backups/myapp
  
  # Backup jobs
  jobs:
    - name: full-nightly
      type: full
      cron: "0 3 * * *"
      format: custom
      compress: true
      keepLast: 7
    - name: tables-frequent
      type: tables
      cron: "*/30 * * * *"
      tables:
        - public.users
        - public.orders
      format: plain
      compress: true
      keepLast: 48
```

**Job fields:**
- `name`: Unique job name
- `type`: `"full"` (full dump) or `"tables"` (specific tables)
- `cron`: Cron expression (e.g., `"0 3 * * *"` = every day at 3 AM)
- `format`: `"plain"` (SQL) or `"custom"` (PostgreSQL format)
- `compress`: `true` to compress the dump
- `keepLast`: Number of backups to keep (local + remote)
- `tables`: (optional) List of tables for `type: "tables"`
- `timeout`: (optional) Timeout in milliseconds for pg_dump

### 4. Using environment variables (optional)

You can use environment variables in the YAML file:

```yaml
source:
  url: ${DATABASE_URL}
target:
  host: ${BACKUP_HOST}
  user: ${BACKUP_USER}
  key_path: ${BACKUP_KEY_PATH}
```

With default values:
```yaml
source:
  url: ${DATABASE_URL:-postgresql://user:pass@localhost:5432/db}
target:
  port: ${BACKUP_PORT:-22}
```

## Usage

### Validate configuration

```bash
shuttle validate -c shuttle.yml
```

Checks that:
- The configuration file is valid
- All required settings are present
- SSH key file exists

### Run jobs once

```bash
shuttle run -c shuttle.yml
```

Executes all jobs immediately, without waiting for cron.

### Run as daemon

```bash
shuttle daemon -c shuttle.yml
```

Starts the daemon that schedules jobs according to their cron expressions. The process stays active until interrupted (Ctrl+C).

### List jobs

```bash
shuttle ls -c shuttle.yml
```

Displays the list of all configured jobs.

## Docker Usage

### Execution modes

Shuttle can run in two ways in Docker:

#### Mode 1: Daemon (recommended)

The container stays active and automatically schedules jobs according to their cron expressions.

```yaml
# docker-compose.yml
version: '3.9'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: myuser
      POSTGRES_PASSWORD: mypassword
      POSTGRES_DB: mydb
    networks:
      - shuttle_net

  shuttle:
    image: claquettes/shuttle:latest
    container_name: shuttle_daemon
    restart: unless-stopped
    depends_on:
      - postgres
    volumes:
      - ./shuttle.yml:/config/shuttle.yml:ro
      - ./ssh_key:/config/ssh_key:ro
      - ./backups:/backups
    networks:
      - shuttle_net
    # Daemon mode: stays active and schedules jobs
    command: shuttle daemon -c /config/shuttle.yml

networks:
  shuttle_net:
    driver: bridge
```

**Configuration `shuttle.yml`:**
```yaml
version: 1
shuttle:
  name: docker-backup
  source:
    url: postgresql://myuser:mypassword@postgres:5432/mydb
  target:
    host: backup.example.com
    user: backup
    key_path: /config/ssh_key
    base_path: /backups/myapp
  jobs:
    - name: daily
      type: full
      cron: "0 3 * * *"
      format: custom
      compress: true
      keepLast: 7
```

#### Mode 2: One-shot (with external cron)

The container executes jobs once then exits. Use an external cron to launch it periodically.

```yaml
# docker-compose.yml
services:
  shuttle:
    image: claquettes/shuttle:latest
    volumes:
      - ./shuttle.yml:/config/shuttle.yml:ro
      - ./ssh_key:/config/ssh_key:ro
      - ./backups:/backups
    networks:
      - shuttle_net
    # One-shot mode: executes once then exits
    command: shuttle run -c /config/shuttle.yml
```

Then use a system cron or cron container to launch periodically:
```bash
# System cron
0 3 * * * docker-compose run --rm shuttle
```

### Important points

1. **Database host**: In Docker, use the service name as host (e.g., `postgres` instead of `localhost`)
2. **Docker network**: Shuttle must be on the same network as PostgreSQL
3. **SSH key**: The `key_path` is relative to the config directory or absolute in the container
4. **Daemon mode**: Container stays active and handles scheduling automatically
5. **One-shot mode**: Useful if you prefer managing scheduling with an external cron

## Backup file structure

Backups are organized as follows:

**Local:**
```
./backups/
  ├── full-nightly_2024-01-15T03-00-00.dump.gz
  ├── full-nightly_2024-01-16T03-00-00.dump.gz
  └── tables-frequent_2024-01-15T10-30-00.sql.gz
```

**Remote (via SSH):**
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

## Security

### Best practices

1. **Never commit secrets**: Add `.env` to `.gitignore` if using environment variables
2. **Version `.yml`**: The `.yml` file can be versioned if it doesn't contain secrets (use ${VAR} for secrets)
3. **SSH key permissions**: Use SSH keys with restrictive permissions (`chmod 600`)
4. **Environment variables in production**: In Docker, use `--env-file` or Docker secrets

### Logs

Shuttle never logs:
- Passwords
- SSH private keys
- Passphrases

Only hostnames and ports (non-sensitive) may appear in logs.

## Development

### Prerequisites

- Node.js >= 18
- PostgreSQL client (`pg_dump` in PATH)
- TypeScript

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Development with hot-reload

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
│   ├── index.ts              # CLI entry point
│   ├── cli/
│   │   ├── commander.ts      # Command definitions
│   │   └── commands/         # Command implementations
│   ├── config/
│   │   ├── schema.ts         # Zod schema for config
│   │   ├── loader.ts         # Load .yml + .env
│   │   └── types.ts          # TypeScript types
│   ├── core/
│   │   ├── jobs.ts           # Job execution
│   │   └── scheduler.ts      # Scheduling with node-cron
│   ├── services/
│   │   ├── pgDump.ts         # pg_dump wrapper
│   │   ├── sshTransfer.ts    # SFTP transfer
│   │   └── retention.ts      # Retention management
│   └── utils/
│       ├── logger.ts         # Logging with pino
│       ├── env.ts            # Environment helpers
│       ├── database.ts        # Database URL parser
│       └── paths.ts          # Path management
├── examples/                 # Configuration examples
├── Dockerfile
└── README.md
```

## License

MIT
