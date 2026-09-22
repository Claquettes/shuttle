import type { Command } from "commander";
import { initLogger } from "../utils/logger.js";

export const DEFAULT_CONFIG_PATH = "shuttle.yml";

/**
 * Résout les options communes à toutes les sous-commandes.
 *
 * `-c/--config` est déclaré à la fois sur le programme et sur chaque
 * sous-commande. Commander donne la priorité au programme pour les flags
 * placés avant le nom de la sous-commande, et à la sous-commande pour ceux
 * placés après. On lit donc explicitement la source de chaque valeur pour
 * accepter les deux formes :
 *
 *   shuttle -c prod.yml run
 *   shuttle run -c prod.yml
 */
export function resolveCommonOptions(cmd: Command): {
  configPath: string;
  verbose: boolean;
  quiet: boolean;
} {
  const parent = cmd.parent;

  const fromCommand = cliValue(cmd, "config");
  const fromParent = parent ? cliValue(parent, "config") : undefined;

  const parentOpts = parent?.opts() ?? {};

  const resolved = {
    configPath: fromCommand ?? fromParent ?? DEFAULT_CONFIG_PATH,
    verbose: Boolean(parentOpts.verbose ?? cmd.opts().verbose),
    quiet: Boolean(parentOpts.quiet ?? cmd.opts().quiet),
  };

  initLogger({ verbose: resolved.verbose, quiet: resolved.quiet });

  return resolved;
}

/**
 * Retourne la valeur d'une option seulement si elle a été fournie en ligne de
 * commande (et non héritée d'une valeur par défaut).
 */
function cliValue(cmd: Command, name: string): string | undefined {
  const source = cmd.getOptionValueSource(name);
  if (source === undefined || source === "default") {
    return undefined;
  }
  const value = cmd.opts()[name];
  return typeof value === "string" ? value : undefined;
}
