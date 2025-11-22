#!/usr/bin/env node

import program from "./cli/commander.js";

// Parse les arguments de la ligne de commande
program.parse(process.argv);

// Si aucune commande n'est fournie, afficher l'aide
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

