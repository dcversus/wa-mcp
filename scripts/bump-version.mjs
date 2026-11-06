#!/usr/bin/env node
/** Moves every version surface and starts the CHANGELOG section for it (ADR
 * 0013). Run from the repo root.
 * Usage: bump-version.mjs [--dry-run] <patch|minor|major|x.y.z> | --list */
import { readFileSync, writeFileSync } from "node:fs";

const SURFACES = [
  ".claude-plugin/marketplace.json",
  "package.json",
  "packages/bridge/package.json",
  "packages/bridge/src/bin.ts",
  "packages/bridge/src/lifecycle.ts",
  "packages/bridge/tests/lifecycle.test.ts",
  "packages/cli/package.json",
  "packages/cli/src/voice-dictation.ts",
  "packages/cli/tests/t140-version-drift.test.ts",
  "packages/cli/tests/t194-channel-plugin.test.ts",
  "packages/mcp-server/package.json",
  "packages/mcp-server/src/server.ts",
  "packages/mcp-server/tests/server.test.ts",
  "packages/pi-extension/package.json",
  "packages/shared/package.json",
  "packages/web-ui/package.json",
  "plugins/claude-code/.claude-plugin/plugin.json",
];

const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(SURFACES.join("\n"));
  process.exit(0);
}
const dryRun = args.includes("--dry-run");
const target = args.find((arg) => !arg.startsWith("--"));
const refuse = (message) => {
  console.error(`bump refused: ${message}`);
  process.exit(1);
};

const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const [major, minor, patch] = current.split(".").map(Number);
const next =
  {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
  }[target] ?? target;
if (next === undefined || !/^\d+\.\d+\.\d+$/.test(next)) {
  refuse("say patch, minor, major or x.y.z");
}
const [a, b] = [next, current].map((value) => value.split(".").map(Number));
const index = a.findIndex((part, at) => part !== b[at]);
if (index === -1 || a[index] < b[index]) {
  refuse(`${next} is not above the current ${current}`);
}
if (dryRun) {
  console.log(`would bump ${current} -> ${next}`);
  process.exit(0);
}

const oldVersion = new RegExp(`\\b${current.replaceAll(".", "\\.")}\\b`, "g");
for (const file of SURFACES) {
  writeFileSync(file, readFileSync(file, "utf8").replace(oldVersion, next));
}
const heading = `## ${next} — ${new Date().toISOString().slice(0, 10)}`;
const changelog = readFileSync("CHANGELOG.md", "utf8");
writeFileSync(
  "CHANGELOG.md",
  /^## Unreleased$/m.test(changelog)
    ? changelog.replace(/^## Unreleased$/m, heading)
    : changelog.replace("# Changelog\n\n", `# Changelog\n\n${heading}\n\n`),
);
console.log(
  `bumped ${current} -> ${next}. Now say what changed under "${heading}" in CHANGELOG.md`,
);
