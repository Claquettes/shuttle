# Shuttle — integration guide for coding agents

Give this file to an agent and it has everything needed to add Shuttle to a
project correctly, without reading the source.

Shuttle is a CLI/daemon that runs `pg_dump` against a PostgreSQL database, ships
the dump to a backup server over SFTP, prunes old backups, and optionally emails
a report. Version 2.0.

---

## 1. Decide the deployment shape first

| Situation | Use |
| --- | --- |
| App already runs in Docker Compose | Add a `shuttle` service in **daemon** mode (§5.1) — most common |
| Kubernetes | A `CronJob` running `shuttle run` (§5.3) |
| Plain VM/server, systemd available | `shuttle daemon` under a systemd unit (§5.4) |
| A scheduler already exists (host cron, Nomad, CI) | `shuttle run` one-shot (§5.2) |

**Daemon vs run:**
- `shuttle daemon` — long-lived, schedules jobs itself from the `cron:` fields, guarantees no overlapping runs. Prefer it.
- `shuttle run` — executes every job once, immediately, then exits. Exit code `0` only if all jobs succeeded. `cron:` is still **required** in the config but ignored. Use it when something else owns scheduling.

---

## 2. Requirements

- **Node.js >= 22.12** — only for the npm install. The Docker image bundles its own.
- **`pg_dump` in `PATH`, version >= the PostgreSQL server.** `pg_dump` refuses to dump a newer server. The Docker image ships client 18 (covers servers up to 18).
- Network route from Shuttle to both the database and the backup server.
- An SSH account on the backup server with key-based auth and write access to `base_path`.

---

## 3. Minimal working configuration

Config file: `shuttle.yml` (also accepts `.yaml`, `.json`, `.apo` — the last two are parsed as JSON).

```yaml
version: 1
shuttle:
  name: my-app-prod
  timezone: Europe/Paris

  source:
    url: ${DATABASE_URL}

  target:
    host: backup.example.com
    port: 22
    user: backup
    key_path: ./ssh_key
    base_path: /backups/my-app
    known_hosts: ./known_hosts
    strict_host_key: true

  jobs:
    - name: nightly
      type: full
      cron: "0 3 * * *"
      format: custom
      compress: true
      keepLast: 7
```

Secrets come from a `.env` file **in the same directory as the config file**, or
from the process environment. `${VAR}` and `${VAR:-default}` are expanded
anywhere in the file. An unset `${VAR}` with no default is left as the literal
text `${VAR}` — it does **not** error, so a typo surfaces later as a confusing
connection failure. Always run `shuttle validate` after wiring env vars.

---

## 4. Complete configuration reference

### 4.1 Root

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `version` | integer > 0 | yes | — | Always `1` |
| `shuttle.name` | string | yes | — | Identifies this instance in logs and email subjects |
| `shuttle.timezone` | string | no | `UTC` | IANA name, e.g. `Europe/Paris`. Applies to `cron:` |
| `shuttle.source` | object | yes | — | §4.2 |
| `shuttle.target` | object | yes | — | §4.3 |
| `shuttle.notifications` | object | no | — | §4.5 |
| `shuttle.jobs` | array | yes | — | At least one. §4.4 |

### 4.2 `source` — the database to dump

Two mutually exclusive forms.

**Form A (preferred):**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | string | yes | Must start with `postgresql://` or `postgres://` |

**Form B:**

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `host` | string | yes | — |
| `port` | integer 1–65535 | no | `5432` |
| `database` | string | yes | — |
| `user` | string | yes | — |
| `password` | string | yes | — (may be empty string) |

Mixing the two forms, or misspelling a key, fails validation with:
`source must be either { url: postgresql://... } or { host, database, user, password }`.

### 4.3 `target` — the backup server

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `host` | string | yes | — | |
| `port` | integer 1–65535 | no | `22` | |
| `user` | string | yes | — | SSH user |
| `key_path` | string | yes | — | SSH **private** key. Relative paths resolve from the **config file's directory**, not the cwd |
| `key_passphrase` | string | no | — | Use `${VAR}` |
| `base_path` | string | yes | — | Absolute path on the backup server |
| `known_hosts` | string | no | — | OpenSSH `known_hosts` file. Relative paths resolve from the config file's directory |
| `host_fingerprint` | string or string[] | no | — | `SHA256:...`. A list is useful during key rotation |
| `strict_host_key` | boolean | no | `false` | `true` = refuse to run unless host verification is configured |

**Set `known_hosts` or `host_fingerprint`.** Without either, Shuttle accepts any
SSH host key, so anyone able to intercept the connection receives a full copy of
the production database. It logs a warning on every run until you do. See §6.

### 4.4 `jobs[]`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `name` | string | yes | — | Must be unique. Used as the filename prefix and the remote directory name |
| `type` | `full` \| `tables` | yes | — | |
| `cron` | string | yes | — | 5 fields, or 6 with a leading seconds field. Evaluated in `shuttle.timezone` |
| `format` | `custom` \| `plain` | no | `custom` | `custom` → `.dump` (restore with `pg_restore`); `plain` → `.sql` (restore with `psql`) |
| `compress` | boolean | no | `true` | gzip, streamed — memory stays flat regardless of dump size |
| `keepLast` | integer > 0 | yes | — | Backups to keep, **both** locally and remotely. See §8 |
| `tables` | string[] | only if `type: tables` | — | `schema.table`, passed as `pg_dump -t` |
| `timeout` | integer (ms) | no | `3600000` (1 h) | `pg_dump` is `SIGTERM`ed then `SIGKILL`ed 10 s later |

`pg_dump` always runs with `--no-owner --no-acl`.

### 4.5 `notifications.email`

Sends a report after **every** backup attempt. SendGrid v3 REST API over HTTPS;
no extra dependency is installed.

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `provider` | `sendgrid` | no | `sendgrid` | Only value supported |
| `api_key` | string | yes | — | Needs the `mail.send` permission. Use `${SENDGRID_API_KEY}` |
| `from` | email | yes | — | Must be a **verified sender** in SendGrid, or sends fail with 403 |
| `from_name` | string | no | — | |
| `to` | email[] | yes | — | At least one |
| `on` | `always` \| `success` \| `failure` | no | `always` | |
| `subject_prefix` | string | no | — | e.g. `"[Prod]"` — useful to tell environments apart |
| `timeout` | integer (ms) | no | `15000` | HTTP timeout for the SendGrid call |

Report contents: source database + `host:port` + user, the machine Shuttle ran
on, destination `user@host:port`, filename, size, format, remote and local
paths, duration, retention counts, and the error when the job failed.

Subject: `[Prefix] [OK|FAILED] <shuttle.name> / <job> — <database>@<host>`

**A failing notification never fails a backup** — send errors are logged as
warnings and the job keeps its own status. The API key is never logged and never
appears in the message body.

---

## 5. Integration recipes

### 5.1 Docker Compose, alongside the app's database

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: appdb
    networks: [backend]

  shuttle:
    image: claquettes/shuttle:latest
    restart: unless-stopped
    depends_on: [postgres]
    networks: [backend]
    env_file: .env
    volumes:
      - ./shuttle.yml:/config/shuttle.yml:ro
      - ./ssh_key:/config/ssh_key:ro
      - ./known_hosts:/config/known_hosts:ro
      - shuttle_backups:/backups
    command: shuttle daemon -c /config/shuttle.yml

networks:
  backend:
volumes:
  shuttle_backups:
```

With `shuttle.yml`:

```yaml
version: 1
shuttle:
  name: appdb-prod
  timezone: Europe/Paris
  source:
    # `postgres` is the compose service name — NOT localhost
    url: postgresql://appuser:${POSTGRES_PASSWORD}@postgres:5432/appdb
  target:
    host: ${BACKUP_HOST}
    user: ${BACKUP_USER}
    key_path: /config/ssh_key
    base_path: /backups/appdb
    known_hosts: /config/known_hosts
    strict_host_key: true
  jobs:
    - name: nightly
      type: full
      cron: "0 3 * * *"
      format: custom
      compress: true
      keepLast: 14
```

Critical points:
- Shuttle must be **on the same network** as the database.
- Use the **service name** as `host`, never `localhost` — in a container `localhost` is the container itself.
- Mount the SSH key **read-only**. Its permissions must be `600` on the host.
- Mount a **named volume** at `/backups`. Without it, local copies are lost on every container recreation and `keepLast` local retention is meaningless.
- The container runs as **UID/GID 1001**. The `/backups` volume must be writable by it (`chown -R 1001:1001 ./backups` for a host bind mount).

### 5.2 One-shot, driven by an external scheduler

```bash
docker compose run --rm shuttle shuttle run -c /config/shuttle.yml
```

Exit code is `0` only if every job succeeded — wire it to your alerting.

### 5.3 Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: shuttle-nightly
spec:
  schedule: "0 3 * * *"
  concurrencyPolicy: Forbid        # never overlap two dumps
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: shuttle
              image: claquettes/shuttle:latest
              args: ["run", "-c", "/config/shuttle.yml"]
              envFrom:
                - secretRef:
                    name: shuttle-secrets
              volumeMounts:
                - { name: config,  mountPath: /config }
                - { name: backups, mountPath: /backups }
          volumes:
            - name: config
              secret:
                secretName: shuttle-config
                defaultMode: 0400
            - name: backups
              persistentVolumeClaim:
                claimName: shuttle-backups
```

Use `shuttle run` (not `daemon`) in a CronJob — Kubernetes owns the schedule.
The `cron:` field in the config is still required but unused.

### 5.4 systemd

```ini
[Unit]
Description=Shuttle PostgreSQL backups
After=network-online.target

[Service]
Type=simple
User=shuttle
WorkingDirectory=/opt/shuttle
ExecStart=/usr/bin/shuttle daemon -c /opt/shuttle/shuttle.yml
Restart=on-failure
RestartSec=30
# Shuttle waits for in-flight backups on SIGTERM; give it room.
TimeoutStopSec=1200

[Install]
WantedBy=multi-user.target
```

---

## 6. SSH setup procedure

Run this once, then keep the outputs in your secret store.

```bash
# 1. Dedicated key pair, no passphrase (or set target.key_passphrase)
ssh-keygen -t ed25519 -N "" -f ./ssh_key -C "shuttle@my-app"
chmod 600 ./ssh_key

# 2. Authorize the public key on the backup server
ssh-copy-id -i ./ssh_key.pub backup@backup.example.com

# 3. Pin the host key — do this from a trusted network
ssh-keyscan -p 22 backup.example.com > ./known_hosts

# 4. Create the destination and check write access
ssh -i ./ssh_key backup@backup.example.com "mkdir -p /backups/my-app && touch /backups/my-app/.probe && rm /backups/my-app/.probe"
```

Then set `known_hosts: ./known_hosts` and `strict_host_key: true`.

Alternative to a `known_hosts` file — pin the fingerprint directly:

```bash
ssh-keyscan backup.example.com 2>/dev/null | ssh-keygen -lf - | awk '{print $2}'
# -> SHA256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```yaml
target:
  host_fingerprint: "SHA256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  strict_host_key: true
```

Hardening the backup account is recommended: a dedicated user, `rrsync` or a
restricted shell, and an append-only destination if your server supports it.

---

## 7. CLI reference

```
shuttle init                    # write a shuttle.yml template in the cwd
shuttle validate [-c <path>]    # check config, print a summary, exit 1 if invalid
shuttle ls       [-c <path>]    # list configured jobs
shuttle run      [-c <path>]    # run every job once, exit 1 if any failed
shuttle daemon   [-c <path>]    # schedule jobs and stay running
```

Global flags: `-c/--config <path>` (default `shuttle.yml`), `-v/--verbose`,
`-q/--quiet` (errors only), `--version`, `--help`.

`-c` works on either side of the subcommand: `shuttle -c prod.yml run` and
`shuttle run -c prod.yml` are equivalent.

Environment variable: `SHUTTLE_LOCAL_BACKUP_DIR` overrides the local backup
directory (default `./backups`, resolved from the **process cwd**, created `0700`).
The Docker image sets it to `/backups`, so mounting a volume there works as
documented.

**Docker invocation** — all of these work:
```bash
docker run --rm IMAGE shuttle validate -c /config/shuttle.yml
docker run --rm IMAGE validate -c /config/shuttle.yml
docker run --rm --entrypoint shuttle IMAGE --version
```

---

## 8. Behaviour you must know before integrating

**File layout.** Local: `<backupdir>/<job>_<UTC timestamp>.<dump|sql>[.gz]`.
Remote: `<base_path>/<job>/<YYYY-MM-DD>/<same filename>`.
Timestamp format: `2026-09-09T03-00-00` (UTC, always).

**Retention deletes files.** `keepLast: 7` keeps the 7 most recent backups of
that job and **deletes the rest, locally and remotely**. It is per-job, matched
on the `<job>_` filename prefix — so renaming a job orphans its old backups
permanently (nothing will ever clean them up). Retention only runs after a
verified transfer, never deletes the backup just created, and leaves alone any
file whose timestamp it cannot parse.

**Upgrading from 1.x:** remote retention was broken in 1.x and never deleted
anything. The first 2.0 run of each job will purge down to `keepLast`. Check
that value before upgrading.

**Transfers are atomic and verified.** Uploads go to `<name>.part`, the remote
size is compared to the local size, and only then is the file renamed. A
mismatch deletes the partial file and fails the job. A `.part` left on the
server means a transfer was interrupted; it is never counted as a backup.

**Empty dumps are rejected** and never uploaded.

**No overlapping runs.** In daemon mode, if a job is still running when its cron
fires again, the new trigger is **skipped** with a warning. Slow jobs silently
lose ticks rather than piling up — if you see those warnings, lengthen the
interval or narrow the job.

**Graceful shutdown.** On `SIGINT`/`SIGTERM` the daemon stops scheduling and
waits up to **15 minutes** for in-flight backups. Set container/systemd stop
timeouts above that, or a transfer gets cut. A second signal forces exit.

**Permissions.** Dumps are written `0600` inside a `0700` directory.

**Memory.** Compression is streamed; peak memory is flat (~75 MB) regardless of
database size.

**Failure isolation.** In `run`, jobs execute sequentially and one failure does
not stop the others; the exit code is `1` if any failed.

---

## 9. Verification checklist

Run these in order. Do not consider the integration done until §9.4 passes.

```bash
# 9.1 Config is structurally valid, and host key verification is ON
shuttle validate -c shuttle.yml
#   expect: "Configuration is valid and ready to use!"
#   expect: "Host key: verified via ..."   (NOT "Host key: NOT VERIFIED")

# 9.2 Jobs are what you expect
shuttle ls -c shuttle.yml

# 9.3 A real backup end to end
shuttle run -c shuttle.yml -v
echo "exit=$?"          # must be 0

# 9.4 The backup actually landed and is restorable
ssh -i ./ssh_key backup@backup.example.com "ls -lR /backups/my-app"
#   expect a file under <job>/<today>/, non-zero size, no .part

# custom format:
gunzip -c ./backups/<job>_<ts>.dump.gz | pg_restore -l | head
# plain format:
gunzip -c ./backups/<job>_<ts>.sql.gz | head -40
```

A backup you have never restored is not a backup. Periodically restore into a
scratch database:

```bash
createdb restore_test
gunzip -c backup.dump.gz | pg_restore -d restore_test --no-owner --no-acl
psql -d restore_test -c "\dt"
```

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `aborting because of server version mismatch` | `pg_dump` older than the server | Use the Docker image (client 18), or install a `postgresql-client` >= your server |
| `Configuration file not found` | `-c` path wrong, or relative to the wrong cwd | Use an absolute path; in Docker check the volume mount |
| `SSH key not found` | `key_path` relative to the **config file's** directory, not the cwd | Use an absolute path in containers |
| `Host key mismatch ... Aborting` | Server key changed, or interception | Verify out-of-band, then refresh `known_hosts`. Do **not** blindly delete the pin |
| `No host key found for <host> in <file>` | `known_hosts` lacks that host **or port** | Non-22 ports are stored as `[host]:port` — re-run `ssh-keyscan -p <port>` |
| `Host key: NOT VERIFIED` warning | No `known_hosts`/`host_fingerprint` | §6 — do not ship to production like this |
| `Transfer verification failed: local X, remote Y` | Truncated upload (disk full, quota, flaky link) | Check free space and quota on the backup server. Nothing was recorded as a backup |
| `Refusing to upload an empty dump` | `pg_dump` produced 0 bytes | Check local disk space and database permissions |
| `connection to server ... failed` in Docker | `localhost` used instead of the service name | Use the compose service name, same network |
| `Previous run is still in progress, skipping` | Job slower than its cron interval | Lengthen the interval, split the job, or raise `timeout` |
| Retention deleted more than expected | `keepLast` counts per job, local **and** remote | Raise `keepLast`; 1.x never pruned remotely so 2.0 catches up on first run |
| Email never arrives, `SendGrid 403` in logs | `from` is not a verified sender | Verify the sender in SendGrid |
| Local backups disappear on redeploy | `/backups` not on a persistent volume | Mount a named volume or PVC |
| `permission denied` writing `/backups` | Volume not writable by UID 1001 | `chown -R 1001:1001` the host directory |

---

## 11. Common mistakes to avoid

- Committing `shuttle.yml` with inline secrets — use `${VAR}` plus a `.env` that is gitignored.
- Shipping without `known_hosts`/`host_fingerprint`.
- Leaving `/backups` on the container filesystem.
- Setting `keepLast: 1` — one corrupt dump and there is no previous copy.
- Using `type: tables` for the main backup: it dumps only those tables, with no schema-wide objects. Use `full` for disaster recovery and `tables` only as a supplement.
- Running `daemon` inside a Kubernetes `CronJob` (two schedulers) — use `run`.
- Pointing several Shuttle instances at the same `base_path` with the same job names — their retention passes will delete each other's backups.
- Assuming a green `shuttle run` means the data is restorable. Test a restore (§9).
