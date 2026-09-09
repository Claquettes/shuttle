#!/usr/bin/env bash
# Smoke test de l'image Docker : le binaire répond et les outils requis à
# l'exécution (pg_dump, ssh) sont bien présents dans l'image.
set -euo pipefail

IMAGE=${1:-shuttle:ci}
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
chmod 777 "$W"

run() { docker run --rm -v "$W:/w" -w /w "$IMAGE" "$@"; }
ok() { echo "  ok   $1"; }

echo "=== Smoke test de $IMAGE ==="

test -n "$(run --version)"
ok "--version répond"

run --help | grep -q "Usage: shuttle"
ok "--help répond"

# Les quatre formes d'invocation doivent fonctionner : la forme documentée dans
# le README (`command: shuttle daemon ...`), les arguments directs, un
# working_dir personnalisé, et le binaire appelé depuis le PATH.
V=$(docker run --rm "$IMAGE" --version)
test "$(docker run --rm "$IMAGE" shuttle --version)" = "$V"
ok "forme documentée 'shuttle <cmd>' acceptée"
test "$(docker run --rm -w /backups "$IMAGE" --version)" = "$V"
ok "fonctionne avec un working_dir personnalisé"
test "$(docker run --rm --entrypoint shuttle "$IMAGE" --version)" = "$V"
ok "binaire 'shuttle' disponible dans le PATH"
docker run --rm "$IMAGE" | grep -q "Usage: shuttle"
ok "sans argument : affiche l'aide"

# pg_dump est indispensable à l'exécution : son absence ne se verrait qu'au
# premier backup nocturne.
PG_VERSION=$(docker run --rm --entrypoint pg_dump "$IMAGE" --version | grep -oE '[0-9]+' | head -1)
test -n "$PG_VERSION"
ok "pg_dump présent dans l'image (version $PG_VERSION)"

# pg_dump REFUSE de dumper un serveur plus récent que lui. Un client trop
# ancien rendrait l'image inutilisable sur les PostgreSQL récents, et cela ne
# se verrait qu'au premier backup nocturne.
if [ "$PG_VERSION" -lt 17 ]; then
  echo "  FAIL pg_dump $PG_VERSION est trop ancien : il ne pourra pas sauvegarder PostgreSQL >= $((PG_VERSION + 1))"
  exit 1
fi
ok "pg_dump assez récent pour les serveurs PostgreSQL courants"

docker run --rm --entrypoint sh "$IMAGE" -c "command -v ssh-keyscan" > /dev/null
ok "client OpenSSH présent dans l'image"

run init > /dev/null
test -f "$W/shuttle.yml"
ok "init génère une configuration"

# La configuration générée doit être structurellement valide : seule la clé SSH
# manque, donc l'échec attendu est précisément celui-là.
touch "$W/ssh_key"
run validate 2>&1 | grep -q "Configuration is valid"
ok "la configuration générée par init est valide"

run ls 2>&1 | grep -q "full-nightly"
ok "ls liste les jobs"

# Le répertoire de sauvegarde locale doit être /backups, sinon le volume que
# les utilisateurs montent est ignoré et les copies locales sont éphémères.
test "$(docker run --rm --entrypoint sh "$IMAGE" -c 'echo $SHUTTLE_LOCAL_BACKUP_DIR')" = "/backups"
ok "les sauvegardes locales pointent sur /backups (volume montable)"

# Une configuration invalide doit sortir en code non nul (sinon un cron
# externe croirait le backup réussi).
echo "version: 1" > "$W/broken.yml"
if run validate -c broken.yml > /dev/null 2>&1; then
  echo "  FAIL une configuration invalide est sortie en code 0"; exit 1
fi
ok "une configuration invalide sort en code non nul"

# L'image ne doit pas tourner en root, et son UID doit rester stable : les
# utilisateurs règlent les permissions de leur volume dessus.
UID_IN_IMAGE=$(docker run --rm --entrypoint id "$IMAGE" -u)
test "$UID_IN_IMAGE" != "0"
ok "le conteneur ne tourne pas en root"
test "$UID_IN_IMAGE" = "1001"
ok "UID stable (1001) — les permissions de volume restent valides"

echo "SMOKE TEST : OK"
