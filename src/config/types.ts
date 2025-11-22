import type { ShuttleConfig, Job, Connections } from "./schema.js";

export type { ShuttleConfig, Job, Connections };

export interface ResolvedConfig {
  config: ShuttleConfig;
  sourceDbConfig: {
    connectionId: string;
  };
  targetSshConfig: {
    connectionId: string;
  };
}

