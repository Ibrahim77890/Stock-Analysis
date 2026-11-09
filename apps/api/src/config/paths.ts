import * as fs from "node:fs";
import * as path from "node:path";

/** The repository root: the nearest parent that contains docs/02-domain (works from src, scripts and dist). */
export function repoRoot(start: string = __dirname): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "docs", "02-domain"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repository root not found");
}
