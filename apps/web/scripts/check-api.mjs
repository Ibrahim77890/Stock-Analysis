// Fails if src/api/schema.d.ts is out of date with docs/02-domain/openapi-gateway.json.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = join(mkdtempSync(join(tmpdir(), "mlab-")), "schema.d.ts");
const cli = new URL("../node_modules/openapi-typescript/bin/cli.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const r = spawnSync(process.execPath, [cli, "../../docs/02-domain/openapi-gateway.json", "-o", tmp], { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
if (readFileSync(tmp, "utf8") !== readFileSync("src/api/schema.d.ts", "utf8")) {
  console.error("src/api/schema.d.ts is stale: run npm run gen:api");
  process.exit(1);
}
console.log("generated API types are current");
