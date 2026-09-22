#!/bin/sh
# Point d'entrée de l'image Shuttle.
#
# Tolère les deux formes d'invocation :
#   docker run shuttle daemon -c /config/shuttle.yml   (forme documentée)
#   docker run shuttle:latest daemon -c /config/...    (arguments directs)
# Le chemin du binaire est absolu : l'image reste fonctionnelle même si
# l'utilisateur définit un working_dir différent de /app.
set -e

if [ "$1" = "shuttle" ]; then
  shift
fi

exec node /app/dist/index.js "$@"
