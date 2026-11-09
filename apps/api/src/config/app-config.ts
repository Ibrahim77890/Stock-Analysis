import { config as loadDotenv } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

export const APP_CONFIG = "APP_CONFIG";

export interface AppConfig {
  port: number;
  databaseUrl: string;
  pythonApiUrl: string;
  internalToken: string;
  jwtSecret: string;
  corsOrigins: string[];
  loginLimit: number; // attempts per minute per client and name
  labRunsPerMinute: number; // Strategy Lab runs per minute per learner
}

/** Raised at start-up; the message names the variable and never a value. */
export class ConfigError extends Error {}

const REQUIRED = ["DATABASE_URL", "INTERNAL_API_TOKEN", "JWT_SECRET"] as const;
const DEFAULT_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173";

/** Loads the repository-root .env (searching upwards from the working directory). Existing variables win. */
export function loadEnvFile(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  for (const name of REQUIRED) {
    if (!env[name] || !env[name]!.trim()) {
      throw new ConfigError(`${name} is not set (add it to .env; see .env.example).`);
    }
  }
  const origins = (env.CORS_ORIGINS ?? DEFAULT_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.includes("*")) throw new ConfigError("CORS_ORIGINS must list exact origins, never *.");
  return {
    port: Number(env.GATEWAY_PORT ?? 3000),
    databaseUrl: env.DATABASE_URL!,
    pythonApiUrl: (env.PYTHON_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, ""),
    internalToken: env.INTERNAL_API_TOKEN!,
    jwtSecret: env.JWT_SECRET!,
    corsOrigins: origins,
    loginLimit: Number(env.LOGIN_LIMIT_PER_MINUTE ?? 5),
    labRunsPerMinute: Number(env.LAB_RUNS_PER_MINUTE ?? 20),
  };
}

/** Replaces every configured secret in `text` by *** (longest first). */
export function redact(text: string, cfg: Pick<AppConfig, "internalToken" | "jwtSecret" | "databaseUrl">): string {
  const secrets = [cfg.internalToken, cfg.jwtSecret, passwordOf(cfg.databaseUrl)].filter((s) => s && s.length >= 6);
  for (const s of secrets.sort((a, b) => b.length - a.length)) text = text.split(s).join("***");
  return text;
}

function passwordOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return "";
  }
}
