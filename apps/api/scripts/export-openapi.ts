import { NestFactory } from "@nestjs/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppModule } from "../src/app.module";
import { swaggerDocument } from "../src/bootstrap";
import { AppConfig } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";

/** Deterministic: sorted keys. Needs no database or Python (providers connect lazily). */
export async function generateDocument(): Promise<unknown> {
  const cfg: AppConfig = {
    port: 3000, databaseUrl: "postgresql://u:p@127.0.0.1:5432/none", pythonApiUrl: "http://127.0.0.1:8000",
    internalToken: "export-only-token", jwtSecret: "export-only-secret", corsOrigins: ["http://127.0.0.1:5173"], loginLimit: 5, labRunsPerMinute: 20,
  };
  const app = await NestFactory.create(AppModule.register(cfg), { logger: false });
  const doc = swaggerDocument(app);
  await app.close();
  return JSON.parse(JSON.stringify(doc, (_k, v) => v));
}

export function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

export const CONTRACT_PATH = path.join(repoRoot(), "docs", "02-domain", "openapi-gateway.json");

async function main(): Promise<void> {
  const doc = sortKeys(await generateDocument());
  fs.writeFileSync(CONTRACT_PATH, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(CONTRACT_PATH);
}

if (require.main === module) void main();
