import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC_DIRS = [
  join(ROOT, "packages/bridge/src"),
  join(ROOT, "packages/cli/src"),
  join(ROOT, "packages/mcp-server/src"),
  join(ROOT, "packages/pi-extension/src"),
];
const DOC = join(ROOT, "docs/configuration.md");

function collectEnvVars(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts")) {
        continue;
      }
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/env\.(WA_[A-Z_]+)/g)) {
        found.add(match[1]!);
      }
      for (const match of source.matchAll(/process\.env\.(WA_[A-Z_]+)/g)) {
        found.add(match[1]!);
      }
    }
  };
  for (const dir of SRC_DIRS) {
    walk(dir);
  }
  return found;
}

const used = collectEnvVars();
const doc = readFileSync(DOC, "utf8");
const documented = new Set<string>();
for (const match of doc.matchAll(/`(WA_[A-Z_]+)`/g)) {
  documented.add(match[1]!);
}

const missing = [...used].filter((name) => !documented.has(name)).sort();
const stale = [...documented].filter((name) => !used.has(name)).sort();

if (missing.length > 0 || stale.length > 0) {
  console.error(`env-doc-coverage FAILED: ${used.size} env vars read in src`);
  if (missing.length > 0) {
    console.error(`  undocumented (${missing.length}): ${missing.join(", ")}`);
  }
  if (stale.length > 0) {
    console.error(`  documented but not read in src (${stale.length}): ${stale.join(", ")}`);
  }
  process.exit(1);
}
console.log(`env-doc-coverage OK: ${used.size}/${used.size} env vars documented`);
