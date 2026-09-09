#!/usr/bin/env bash
# Lance la suite de tests.
#
#   ./tests/run.sh          tests unitaires + SFTP (aucun prérequis externe)
#   ./tests/run.sh --full   ajoute l'E2E : nécessite pg_dump, et Docker sauf si
#                           une base est déjà fournie via SHUTTLE_TEST_PG_EXTERNAL=1
#
# En CI, la base est fournie par un `services:` PostgreSQL : positionner
# SHUTTLE_TEST_PG_EXTERNAL=1 et les variables PG* standard.
set -euo pipefail

cd "$(dirname "$0")/.."
FULL=${1:-}
TDIR=$(mktemp -d)
EXTERNAL_PG=${SHUTTLE_TEST_PG_EXTERNAL:-0}

cleanup() {
  rm -rf "$TDIR"
  [ "$EXTERNAL_PG" = "1" ] || docker rm -f shuttle-pgtest >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Build..."
npm run build --silent

echo "Génération des clés SSH de test..."
ssh-keygen -t ed25519 -N "" -f "$TDIR/hostkey" -q
ssh-keygen -t ed25519 -N "" -f "$TDIR/clientkey" -q
ssh-keygen -lf "$TDIR/hostkey.pub" | awk '{print $2}' > "$TDIR/expected_fp"

export TDIR
FAILED=0
run() { echo; echo "──── $1 ────"; node "$2" || FAILED=1; }

run "CLI"                                  tests/cli.test.mjs
run "Exemples de la documentation"          tests/docs.test.mjs
run "Rapport email"                        tests/email.test.mjs
run "Sécurité SSH / transfert / rétention" tests/safety.test.mjs
run "Scheduler"                            tests/scheduler.test.mjs

if [ "$FULL" = "--full" ]; then
  export PGHOST=${PGHOST:-127.0.0.1}
  export PGPORT=${PGPORT:-55432}
  export PGDATABASE=${PGDATABASE:-testdb}
  export PGUSER=${PGUSER:-testuser}
  export PGPASSWORD=${PGPASSWORD:-testpw}

  if [ "$EXTERNAL_PG" = "1" ]; then
    echo; echo "Utilisation de la base fournie : $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
  else
    echo; echo "Démarrage de PostgreSQL (Docker)..."
    # pg_dump doit être au moins aussi récent que le serveur.
    PG_MAJOR=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
    docker run -d --rm --name shuttle-pgtest \
      -e POSTGRES_PASSWORD="$PGPASSWORD" -e POSTGRES_USER="$PGUSER" \
      -e POSTGRES_DB="$PGDATABASE" -p "$PGPORT:5432" "postgres:${PG_MAJOR}-alpine" >/dev/null
  fi

  echo "Attente de la base..."
  for _ in $(seq 1 60); do
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1" >/dev/null 2>&1 && break
    sleep 1
  done

  echo "Chargement du jeu de données..."
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -q -v ON_ERROR_STOP=1 -f tests/seed.sql

  run "Bout en bout (PostgreSQL + SFTP réels)" tests/e2e.test.mjs
else
  echo; echo "(E2E ignoré — relancer avec --full pour l'inclure)"
fi

echo
if [ "$FAILED" = 0 ]; then echo "SUITE COMPLÈTE : OK"; else echo "SUITE : ÉCHECS"; exit 1; fi
