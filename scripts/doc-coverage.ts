import { readFileSync } from "node:fs";

const registrySource = readFileSync(
  new URL("../packages/mcp-server/src/tools.ts", import.meta.url),
  "utf8",
);
const names = [...registrySource.matchAll(/name: "([a-z_]+)"/g)].map((match) => match[1]);
if (names.length === 0) {
  console.error("docs-coverage FAILED: no tool names found in the registry source");
  process.exit(1);
}
const docs = readFileSync(new URL("../docs/reference/tools.md", import.meta.url), "utf8");
const missing = names.filter((name) => !docs.includes(`### ${name}`));
if (missing.length > 0) {
  console.error(
    `docs-coverage FAILED: ${missing.length} tools missing from docs/reference/tools.md: ${missing.join(", ")}`,
  );
  process.exit(1);
}
console.log(`docs-coverage OK: ${names.length}/${names.length} tools documented`);
