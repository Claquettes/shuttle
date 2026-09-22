## Objet

<!-- Que change cette PR, et pourquoi ? -->

## Impact sur les sauvegardes

Cochez ce qui s'applique — Shuttle manipule des copies de bases de production.

- [ ] Aucun impact sur le chemin dump → transfert → rétention
- [ ] Touche au **dump** (`pgDump.ts`)
- [ ] Touche au **transfert** (`sshTransfer.ts`, `hostKey.ts`)
- [ ] Touche à la **rétention** (`retention.ts`) — c'est le seul code qui supprime des fichiers
- [ ] Touche à la **planification** (`scheduler.ts`, `jobs.ts`)
- [ ] Change le format de la configuration (préciser la compatibilité ascendante)

## Vérifications

- [ ] `npm test` passe en local
- [ ] `npm run test:full` passe en local (nécessite Docker)
- [ ] Des tests couvrent le changement
- [ ] Si un comportement de suppression change : un test prouve qu'aucune sauvegarde valide ne peut être perdue

## Notes pour la relecture

<!-- Points d'attention, choix d'implémentation, limites connues -->
