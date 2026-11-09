import "reflect-metadata";
import { buildApp } from "./bootstrap";
import { ConfigError, loadConfig, loadEnvFile } from "./config/app-config";

async function main(): Promise<void> {
  loadEnvFile();
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`MarketLab gateway cannot start: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  const app = await buildApp(cfg);
  await app.listen(cfg.port, "127.0.0.1"); // loopback only: Tiingo data are for internal use
  console.log(`MarketLab gateway listening on http://127.0.0.1:${cfg.port} (Swagger: /docs)`);
}

void main();
