# Shuttle

[![CI](https://github.com/Claquettes/shuttle/actions/workflows/ci.yml/badge.svg)](https://github.com/Claquettes/shuttle/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@claquettes/shuttle)](https://www.npmjs.com/package/@claquettes/shuttle)
[![license](https://img.shields.io/npm/l/@claquettes/shuttle)](./LICENSE)

**Shuttle** is a PostgreSQL backup tool that exports your databases and automatically transfers them to a remote server via SSH.

- **npm package**: [`@claquettes/shuttle`](https://www.npmjs.com/package/@claquettes/shuttle)
- **Docker image**: [`claquettes/shuttle`](https://hub.docker.com/r/claquettes/shuttle)
- **GitHub**: [claquettes/shuttle](https://github.com/claquettes/shuttle)

## Features

- **Simple configuration**: Single YAML file with PostgreSQL URL support
- **Flexible**: Secrets can be in the YAML file or via environment variables (${VAR})
- **Docker support**: Works seamlessly with containerized databases
- **Flexible scheduling**: Uses cron expressions to schedule backups
- **Verified transfers**: Every upload is atomic and size-checked before it counts as a backup
- **SSH host key verification**: Pins the backup server via `known_hosts` or a fingerprint
- **Automatic retention**: Manages backup retention automatically (local + remote)
- **Dump types**: Supports full dumps or specific tables
- **Compression**: Optional dump compression
- **Email reports**: Sends a report after every backup via SendGrid (source server + what was shipped)
- **Complete CLI**: Commands for init, validate, run, daemon, ls
- **Up-to-date `pg_dump`**: the Docker image ships PostgreSQL client 18, so it can back up any server up to 18

> **Integrating Shuttle into a project?** [`documentation-agent.md`](./documentation-agent.md)
> is a single self-contained reference — configuration schema, deployment
> recipes, verification checklist and troubleshooting — written to be handed
> straight to a coding agent.

## Requirements

- **Node.js >= 22.12** (only needed for the npm install — the Docker image bundles its own)
- **`pg_dump`** available in `PATH`, at a version **>= your PostgreSQL server**
  (`pg_dump` refuses to dump a newer server). The Docker image bundles client 18.
- An SSH account on the backup server, with key-based authentication

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

## Upgrading to 2.0

2.0 raises the minimum Node version to **22.12** (1.x claimed 18, which is now
end-of-life and pinned the project to a vulnerable `node-cron`). If you run the
Docker image, nothing changes — it already ships Node 22.

Nothing in the configuration file format changed: **1.x configs work as-is**.
Two things are new and worth adopting:

- `target.known_hosts` / `target.host_fingerprint` — pin the backup server's SSH
  key. Without it Shuttle accepts any host key and logs a warning on every run.
- `notifications.email` — get a report after every backup.

Behaviour that changed without any config change on your side:

- Uploads are now verified and atomic; a truncated transfer fails the job
  instead of being recorded as a successful backup.
- Remote retention actually deletes now. In 1.x it silently never removed
  anything, so **expect a one-off cleanup** on the first run of each job —
  check `keepLast` is what you want before upgrading.
- `-c/--config` is honoured. In 1.x it was ignored and `./shuttle.yml` was
  always loaded, so a config you thought was live may not have been.

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
    # Host key verification (strongly recommended, see "Security")
    known_hosts: ./known_hosts
    strict_host_key: true
  
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

### 5. Securing the backup server connection

By default Shuttle accepts **any** SSH host key. Anyone able to intercept the
connection (DNS, BGP, a compromised network) can impersonate your backup server
and receive a full copy of your production database. Shuttle logs a warning on
every run until you pin the host key.

**Option A — `known_hosts` (recommended):**

```bash
ssh-keyscan -p 22 backup.example.com > known_hosts
```

```yaml
target:
  host: backup.example.com
  known_hosts: ./known_hosts   # relative paths resolve from the config file
  strict_host_key: true        # refuse to start if verification is unavailable
```

**Option B — pin a fingerprint:**

```bash
ssh-keyscan backup.example.com | ssh-keygen -lf -    # -> SHA256:xxxxx
```

```yaml
target:
  host: backup.example.com
  host_fingerprint: "SHA256:pzTFcAtnCVOzpCwkJymeLIaaZLldXo1252q7cqaw7Ks"
  strict_host_key: true
```

`host_fingerprint` also accepts a list, which is useful while rotating keys.
If the server presents a key that does not match, the transfer is aborted and
the job fails — it never falls back to an unverified connection.

Check the current state at any time:

```bash
shuttle validate -c shuttle.yml
```

### 6. Backup integrity guarantees

Shuttle is built so that a failure never silently destroys a good backup:

- **Atomic uploads** — files are written remotely as `<name>.part` and renamed
  only after verification, so an interrupted transfer never leaves a truncated
  file under a valid backup name.
- **Size verification** — the remote size is compared to the local size. On
  mismatch the partial file is deleted and the job fails.
- **Empty dumps are rejected** — a zero-byte dump (disk full, permissions) is
  never uploaded and never counted as a backup.
- **Retention never touches the fresh backup** — the file just uploaded is
  explicitly protected from the retention pass.
- **Retention only deletes what it understands** — a file whose timestamp
  cannot be parsed, or a `.part` leftover, is left alone rather than guessed at.
- **Retention runs only after a verified transfer** — it shares the same SSH
  session as the upload, so a failed transfer can never trigger a purge.
- **No overlapping runs** — if a job is still running when its cron fires again,
  the new trigger is skipped instead of starting a second concurrent dump.
- **Graceful shutdown** — on `SIGINT`/`SIGTERM` the daemon stops scheduling and
  waits (up to 15 min) for in-flight backups rather than cutting a transfer.
- **Restrictive permissions** — dumps are written `0600` in a `0700` directory.
- **Bounded memory** — dumps are compressed as a stream, so peak memory stays
  flat (~75 MB) regardless of database size.

### 7. Email reports (optional)

Shuttle can email a report **after every backup**, describing the origin server it
dumped and exactly what it shipped. Reports are sent through the
[SendGrid v3 API](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
over plain HTTPS — no extra dependency is installed.

```yaml
version: 1
shuttle:
  name: my-prod-shuttle
  source:
    url: ${DATABASE_URL}
  target:
    host: backup.example.com
    user: backup
    key_path: ./ssh_key
    base_path: /backups/myapp

  notifications:
    email:
      provider: sendgrid
      api_key: ${SENDGRID_API_KEY}   # keep this in .env, never in the YAML
      from: shuttle@example.com      # must be a verified SendGrid sender
      from_name: Shuttle             # optional
      to:
        - ops@example.com
        - cto@example.com
      on: always                     # always | success | failure
      subject_prefix: "[Prod]"       # optional
      timeout: 15000                 # optional, ms (default 15000)

  jobs:
    - name: full-nightly
      type: full
      cron: "0 3 * * *"
      keepLast: 7
```

**Fields:**
- `provider`: only `sendgrid` is supported today
- `api_key`: SendGrid API key with the `mail.send` permission
- `from` / `from_name`: sender, must be verified in your SendGrid account
- `to`: one or more recipients
- `on`: `always` (default), `success` only, or `failure` only
- `subject_prefix`: prepended to the subject, useful to tell environments apart
- `timeout`: HTTP timeout for the SendGrid call, in milliseconds

**What the report contains:**

| Section | Content |
| --- | --- |
| Summary | Shuttle name, job name and type, tables, start time, duration |
| Origin server | Source database name, host:port, user, and the machine Shuttle ran on |
| Destination | `user@host:port` of the backup server |
| File shipped | Filename, size, format, compression, remote path, local path |
| Retention | Number of local and remote files deleted |
| Error | Failure reason, when the job did not succeed |

Subject line format:

```
[Prod] [OK] my-prod-shuttle / full-nightly — myapp@db.internal
```

**Notes:**
- A failing notification never fails a backup: send errors are logged as warnings and the job keeps its own status.
- The API key is never logged and never appears in the message body.
- Keep the key out of the YAML by using `${SENDGRID_API_KEY}` with a `.env` file next to the config.

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

0. **Persist `/backups`**: mount a named volume (or a host directory) at
   `/backups`. The image sets `SHUTTLE_LOCAL_BACKUP_DIR=/backups`, so local
   copies land there. Without a volume they live in the container layer and are
   lost on every recreation, which makes local `keepLast` retention pointless.
   The container runs as **UID/GID 1001** — a host bind mount needs
   `chown -R 1001:1001`.
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

0. **Pin the backup server host key**: set `known_hosts` or `host_fingerprint`
   with `strict_host_key: true` (see "Securing the backup server connection").
   Without it, Shuttle accepts any host key.
1. **Never commit secrets**: Add `.env` to `.gitignore` if using environment variables
2. **Version `.yml`**: The `.yml` file can be versioned if it doesn't contain secrets (use ${VAR} for secrets)
3. **SSH key permissions**: Use SSH keys with restrictive permissions (`chmod 600`)
4. **Environment variables in production**: In Docker, use `--env-file` or Docker secrets

### Logs

Shuttle never logs:
- Passwords
- SSH private keys
- Passphrases
- Notification API keys

Only hostnames and ports (non-sensitive) may appear in logs.

## Development

### Prerequisites

- Node.js >= 22.12
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

### Tests

```bash
npm test
```

Runs the CLI, documentation, email, SSH/transfer/retention and scheduler suites.
The transfer tests run against a real in-process SFTP server, so host key
verification, atomic uploads and size checks are exercised for real. The
documentation suite validates every configuration example in the README and in
`documentation-agent.md` against the real binary, so the docs cannot drift.

```bash
npm run test:full
```

Adds the end-to-end suite: spins up a throwaway PostgreSQL in Docker, takes a
real dump, ships it over SFTP and checks it is restorable with `pg_restore`.
Requires Docker and a `pg_dump` matching the server major version.

## Architecture

```
shuttle/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli/
│   │   ├── commander.ts      # Command definitions
│   │   ├── options.ts        # Shared CLI option resolution
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
│   │   ├── sshTransfer.ts    # SFTP transfer (atomic + verified)
│   │   ├── hostKey.ts        # SSH host key verification
│   │   ├── retention.ts      # Retention management
│   │   └── emailReport.ts    # SendGrid backup reports
│   └── utils/
│       ├── logger.ts         # Logging with pino
│       ├── env.ts            # Environment helpers
│       ├── database.ts       # Database URL parser
│       ├── format.ts         # Byte/duration formatting
│       └── paths.ts          # Path management
├── tests/                    # Test suite (real SFTP + PostgreSQL)
│   ├── run.sh                # Test runner
│   ├── sftpServer.mjs        # In-process SFTP server used by the tests
│   ├── cli.test.mjs          # CLI behaviour and config validation
│   ├── docs.test.mjs         # Validates every config example in the docs
│   ├── email.test.mjs        # SendGrid report contents
│   ├── safety.test.mjs       # Host keys, transfer integrity, retention
│   ├── scheduler.test.mjs    # Overlap guard, graceful shutdown
│   ├── memory.test.mjs       # Bounded-memory compression
│   ├── e2e.test.mjs          # Full chain against a real database
│   └── docker-smoke.sh       # Docker image smoke test
├── .github/workflows/
│   ├── ci.yml                # Lint, tests, E2E, Docker, package, audit
│   └── release.yml           # npm + Docker publishing on tag
├── documentation-agent.md    # Self-contained integration guide for agents
├── examples/                 # Configuration examples
├── docker-entrypoint.sh
├── Dockerfile
└── README.md
```

## Continuous integration

Every pull request and every push to `main` runs the full pipeline
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job | What it checks |
| --- | --- |
| **Lint & build** | ESLint, Prettier, strict TypeScript build |
| **Tests** | CLI, doc examples, email, SSH/transfer/retention, scheduler — on Node 22 and 24 |
| **E2E** | Real dump → transfer → retention → restore, against PostgreSQL 14, 15, 16 and 17 |
| **Memory** | Compressing a ~200 MB dump must not let memory scale with dump size |
| **Docker** | Builds `Dockerfile.production` and smoke-tests the image |
| **Package** | `npm pack` contents, then installs the tarball and runs the binary |
| **Audit** | Fails on any high-severity dependency vulnerability |

The `CI` job aggregates all of them — set it as the **required status check** on
`main` so nothing merges on a red pipeline.

Dependencies are updated weekly by Dependabot; each update goes through the same
pipeline, so a bump that would break a backup is caught before it merges.

## Releasing

Releases are driven by a version tag
([`.github/workflows/release.yml`](.github/workflows/release.yml)):

```bash
npm version patch      # or minor / major — updates package.json
git push && git push --tags
```

The workflow re-runs lint, build and the complete test suite (including E2E),
verifies the tag matches `package.json`, and only then publishes:

- the npm package, with build provenance
- multi-arch Docker images (`linux/amd64`, `linux/arm64`) to Docker Hub and GHCR
- a GitHub release with generated notes

The Docker image is built and smoke-tested **before** anything is pushed, so a
broken image is never published.

Run it with **Actions → Release → Run workflow** to do a full dry run that
builds and tests everything without publishing.

### Required secrets

Set these on the `release` environment:

| Secret | Used for |
| --- | --- |
| `NPM_TOKEN` | Publishing to npm (automation token) |
| `DOCKERHUB_USERNAME` | Docker Hub login |
| `DOCKERHUB_TOKEN` | Docker Hub access token |

`GITHUB_TOKEN` is provided automatically for GHCR and the GitHub release.

## License

MIT
