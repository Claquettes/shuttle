#!/bin/bash
# =============================================================================
# Exemple : Utiliser Shuttle avec un cron externe (mode one-shot)
# =============================================================================
# Au lieu d'utiliser le mode daemon, on peut lancer shuttle run via cron
# =============================================================================

# Dans votre docker-compose, utilisez un conteneur cron qui appelle shuttle run
# Exemple avec un conteneur cron simple

# docker-compose.yml:
# services:
#   shuttle-cron:
#     image: shuttle:latest
#     volumes:
#       - ./shuttle.yml:/config/shuttle.yml:ro
#       - ./ssh_key:/config/ssh_key:ro
#       - ./backups:/backups
#     command: >
#       sh -c "
#       echo '0 3 * * * shuttle run -c /config/shuttle.yml' | crontab - &&
#       crond -f
#       "

