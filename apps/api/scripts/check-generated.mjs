// Fails if src/python/schema.d.ts is out of date with docs/02-domain/openapi-market-data.json.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const tmp = join(mkdtempSync(join(tmpdir(), "mlab-")), "schema.d.ts");
const r = spawnSync(process.execPath, [here("../node_modules/openapi-typescript/bin/cli.js"), here("../../../docs/02-domain/openapi-market-data.json"), "-o", tmp], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
if (readFileSync(tmp, "utf8") !== readFileSync(here("../src/python/schema.d.ts"), "utf8")) {
  console.error("src/python/schema.d.ts is stale: run npm run gen:python-api");
  process.exit(1);
}
console.log("generated Python API types are current");
