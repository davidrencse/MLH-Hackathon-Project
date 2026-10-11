import { resolve } from "node:path";
export interface Config {
  host: string;
  port: number;
  databasePath: string;
  dataDir: string;
  artifactsDir: string;
  apiToken?: string;
  allowedWorkspaces: string[];
  allowedOrigins?: string[];
  concurrency: number;
  providerConcurrency: number;
  taskTimeoutMs: number;
  maxRetries: number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const positive = (
    key: string,
    fallback: number,
    max = Number.MAX_SAFE_INTEGER,
  ) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`${key} must be an integer between 1 and ${max}`);
    return value;
  };
  const host = env.HOST ?? "127.0.0.1";
  const apiToken = env.GHOSTGRID_API_TOKEN;
  if (apiToken !== undefined && (!apiToken.trim() || /[\s\x00-\x1f\x7f]/.test(apiToken)))
    throw new Error("GHOSTGRID_API_TOKEN must be a nonempty token without whitespace or control characters");
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && !apiToken)
    throw new Error("GHOSTGRID_API_TOKEN is required for remote binding");
  const dataDir = resolve(env.GHOSTGRID_DATA_DIR ?? "data");
  return {
    host,
    port: positive("PORT", 3001, 65535),
    databasePath:
      env.GHOSTGRID_DATABASE_PATH ?? resolve(dataDir, "ghostgrid.sqlite"),
    dataDir,
    artifactsDir: resolve(dataDir, "artifacts"),
    apiToken,
    maxRetries: positive("GHOSTGRID_MAX_ATTEMPTS", 3, 4) - 1,
    allowedOrigins: (env.GHOSTGRID_ALLOWED_ORIGINS ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.origin !== value)
          throw new Error("GHOSTGRID_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths");
        return value;
      }),
    allowedWorkspaces: (env.GHOSTGRID_ALLOWED_WORKSPACES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolve(s)),
    concurrency: positive("GHOSTGRID_CONCURRENCY", 4, 32),
    providerConcurrency: positive("GHOSTGRID_PROVIDER_CONCURRENCY", 2, 32),
    taskTimeoutMs: positive("GHOSTGRID_TASK_TIMEOUT_MS", 300000, 3600000),
  };
}
