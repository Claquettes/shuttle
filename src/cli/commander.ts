import { Command } from "commander";
import { createRequire } from "module";
import { initCommand } from "./commands/init.js";
import { validateCommand } from "./commands/validate.js";
import { runCommand } from "./commands/run.js";
import { daemonCommand } from "./commands/daemon.js";
import { lsCommand } from "./commands/ls.js";

// Évite que la version de la CLI dérive de celle du package.json
const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

const program = new Command();

program.name("shuttle").description("PostgreSQL backup tool with SSH transfer").version(version);

program
  .option("-c, --config <path>", "Path to config file (.yml, .yaml, .json, .apo)", "shuttle.yml")
  .option("-v, --verbose", "Verbose output")
  .option("-q, --quiet", "Quiet output (errors only)");

program.addCommand(initCommand());
program.addCommand(validateCommand());
program.addCommand(runCommand());
program.addCommand(daemonCommand());
program.addCommand(lsCommand());

export default program;
