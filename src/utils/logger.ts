import pino from "pino";

let loggerInstance: pino.Logger | null = null;

export interface LoggerOptions {
  verbose?: boolean;
  quiet?: boolean;
}

export function initLogger(options: LoggerOptions = {}): pino.Logger {
  const level = options.quiet ? "error" : options.verbose ? "debug" : "info";

  loggerInstance = pino({
    level,
    transport:
      process.env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              ignore: "pid,hostname",
            },
          }
        : undefined,
  });

  return loggerInstance;
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    return initLogger();
  }
  return loggerInstance;
}

export const logger = {
  info: (msg: string, ...args: unknown[]) => getLogger().info(msg, ...args),
  warn: (msg: string, ...args: unknown[]) => getLogger().warn(msg, ...args),
  error: (msg: string, ...args: unknown[]) => getLogger().error(msg, ...args),
  debug: (msg: string, ...args: unknown[]) => getLogger().debug(msg, ...args),
};

