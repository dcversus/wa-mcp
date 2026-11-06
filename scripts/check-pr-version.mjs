#!/usr/bin/env node
/** Every PR ships its own version (ADR 0013). Run by the required `security`
 * job: unless a PR only touches infra and CI, it must move the version up and
 * carry a dated, non-empty CHANGELOG section for it. version-drift.mjs checks
 * that every surface agrees. Usage: check-pr-version.mjs <base-ref> */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** What never reaches a user. Decided by the files a PR changes, not a label,
 * so a PR can't opt out. */
const INFRA = [
  /^\.github\//,
  /^\.claude\//,
  /^\.agents\//,
  /^scripts\//,
  /^\.gitattributes$/,
  /^\.gitignore$/,
  /^\.gitleaksignore$/,
  /^\.prettierignore$/,
  /^AGENTS\.md$/,
  /^CONTRIBUTING\.md$/,
  /^tests-global-setup\.mjs$/,
  /^vite\.config\.ts$/,
];

const base = process.argv[2] ?? "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const fail = (message) => {
  console.error(`version check FAILED: ${message}`);
  process.exit(1);
};

const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
if (changed.every((path) => INFRA.some((pattern) => pattern.test(path)))) {
  console.log("version check OK: this PR only touches infra and CI, no bump needed");
  process.exit(0);
}

const baseVersion = JSON.parse(git("show", `${base}:package.json`)).version;
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const parts = (value) => value.split(".").map(Number);
const movedUp = () => {
  const [a, b] = [parts(version), parts(baseVersion)];
  const index = a.findIndex((part, at) => part !== b[at]);
  return index !== -1 && a[index] > b[index];
};
if (!/^\d+\.\d+\.\d+$/.test(version) || !movedUp()) {
  fail(
    `the version is ${version} and the base is ${baseVersion}, so it has to move up. ` +
      "Run: node scripts/bump-version.mjs patch (or minor, major)",
  );
}

const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
const start = lines.findIndex((line) => line.startsWith("## "));
const heading = `## ${version} — YYYY-MM-DD`;
if (
  !new RegExp(`^## ${version.replaceAll(".", "\\.")} — \\d{4}-\\d{2}-\\d{2}$`).test(
    lines[start] ?? "",
  )
) {
  fail(`CHANGELOG.md has to start with a "${heading}" section, found "${lines[start] ?? "none"}"`);
}
const end = lines.findIndex((line, at) => at > start && line.startsWith("## "));
const body = lines
  .slice(start + 1, end === -1 ? undefined : end)
  .join("")
  .trim();
if (body.length === 0) {
  fail(`the "${lines[start]}" section in CHANGELOG.md is empty: say what changed for users`);
}
console.log(`version check OK: ${baseVersion} -> ${version}, CHANGELOG section present`);
