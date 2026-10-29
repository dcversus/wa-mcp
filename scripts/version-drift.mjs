#!/usr/bin/env node
/** Version-drift guard (Phase 0 requirement): every version surface must
 * carry the SAME version. Fails listing every mismatch. Surfaces:
 * root package.json, 5 workspace package.json files, bridge bin.ts SERVER
 * payload, mcp-server SERVER_INFO, bridge device label, CHANGELOG head. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((line) => line.length > 0);

const expected = JSON.parse(read("package.json")).version;
const failures = [];
const check = (surface, actual) => {
  if (actual !== expected) {
    failures.push(`${surface}: ${actual} !== ${expected}`);
  }
};

for (const pkg of [
  "package.json",
  "packages/bridge/package.json",
  "packages/cli/package.json",
  "packages/mcp-server/package.json",
  "packages/pi-extension/package.json",
  "packages/shared/package.json",
  "packages/web-ui/package.json",
]) {
  check(pkg, JSON.parse(read(pkg)).version);
}

const binSource = read("packages/bridge/src/bin.ts");
const binVersion = binSource.match(/version: "([^"]+)"/);
if (binVersion === null) {
  failures.push("packages/bridge/src/bin.ts: version literal not found");
} else {
  check("packages/bridge/src/bin.ts (SERVER payload)", binVersion[1]);
}

const serverSource = read("packages/mcp-server/src/server.ts");
const serverVersion = serverSource.match(
  /export const SERVER_INFO = \{ name: "wa-mcp", version: "([^"]+)" \}/,
);
if (serverVersion === null) {
  failures.push("packages/mcp-server/src/server.ts: SERVER_INFO literal not found");
} else {
  check("packages/mcp-server/src/server.ts (SERVER_INFO)", serverVersion[1]);
}

const lifecycleSource = read("packages/bridge/src/lifecycle.ts");
const deviceVersion = lifecycleSource.match(/"chrome", "([^"]+)"\]/);
if (deviceVersion === null) {
  failures.push("packages/bridge/src/lifecycle.ts: device label not found");
} else {
  check("packages/bridge/src/lifecycle.ts (device label)", deviceVersion[1]);
}

const pluginManifest = read("plugins/claude-code/.claude-plugin/plugin.json");
const pluginVersion = JSON.parse(pluginManifest).version;
check("plugins/claude-code/.claude-plugin/plugin.json", pluginVersion);
const marketplace = read(".claude-plugin/marketplace.json");
const marketVersion = JSON.parse(marketplace).plugins[0]?.version;
if (marketVersion !== undefined) {
  check(".claude-plugin/marketplace.json (plugin entry)", marketVersion);
}

const changelog = read("CHANGELOG.md");
if (!new RegExp(`^## ${expected.replaceAll(".", "\\.")}( |$)`, "m").test(changelog)) {
  failures.push(`CHANGELOG.md: missing "## ${expected}" heading`);
}

/** R2-0.1.0: no stale version mentions in repo-owned files. The forbidden
 * literals are built by concatenation so this script never matches itself.
 * Excluded: pnpm-lock.yaml (dependency versions belong to third parties). */
const STALE = ["0.9" + ".0", "0.8" + ".0"];
const STALE_EXEMPT = new Set(["pnpm-lock.yaml"]);
for (const file of tracked) {
  if (STALE_EXEMPT.has(file) || !/\.(md|ts|mjs|mts|json|yml|yaml|sh|html|txt)$/.test(file)) {
    continue;
  }
  if (!existsSync(join(root, file))) {
    continue; // deleted-but-tracked (staged removals)
  }
  const body = read(file);
  for (const stale of STALE) {
    if (body.includes(stale)) {
      failures.push(`${file}: stale version mention ${stale}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`version-drift FAILED (expected ${expected}):`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
console.log(`version-drift OK: all surfaces at ${expected}, no stale mentions`);
