import type { ShuttleConfig, Job, SourceConfig, TargetConfig } from "./schema.js";
import type { DatabaseConfig } from "../utils/env.js";
import type { SSHConfig } from "../utils/env.js";

export type { ShuttleConfig, Job, SourceConfig, TargetConfig };

export interface ResolvedConfig {
  config: ShuttleConfig;
  sourceDbConfig: DatabaseConfig;
  targetSshConfig: SSHConfig;
}
