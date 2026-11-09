import { spawnSync } from "node:child_process";
import * as path from "node:path";

/** Applies the gateway migrations to the throwaway database (idempotent). Needs TEST_DATABASE_URL. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return; // database tests are skipped without it
  const cli = path.resolve(__dirname, "../node_modules/node-pg-migrate/bin/node-pg-migrate.js");
  const r = spawnSync(process.execPath, [cli, "up", "-m", "migrations", "--migrations-schema", "app", "--migrations-table", "pgmigrations", "--create-migrations-schema", "--database-url-var", "DATABASE_URL"],
    { cwd: path.resolve(__dirname, ".."), env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  if (r.status !== 0) throw new Error("gateway migrations failed:\n" + r.stdout + r.stderr);
}
