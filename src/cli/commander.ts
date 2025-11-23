import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { validateCommand } from "./commands/validate.js";
import { runCommand } from "./commands/run.js";
import { daemonCommand } from "./commands/daemon.js";
import { lsCommand } from "./commands/ls.js";

const program = new Command();

program
  .name("shuttle")
  .description("PostgreSQL backup tool with SSH transfer")
  .version("1.0.0");

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

