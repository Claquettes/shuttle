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
  info: (msg: string, ...args: unknown[]) => {
    if (args.length > 0) {
      getLogger().info({ args }, msg);
    } else {
      getLogger().info(msg);
    }
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (args.length > 0) {
      getLogger().warn({ args }, msg);
    } else {
      getLogger().warn(msg);
    }
  },
  error: (msg: string, ...args: unknown[]) => {
    if (args.length > 0) {
      getLogger().error({ args }, msg);
    } else {
      getLogger().error(msg);
    }
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (args.length > 0) {
      getLogger().debug({ args }, msg);
    } else {
      getLogger().debug(msg);
    }
  },
};

