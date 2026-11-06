import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";

const ROOT = join(import.meta.dirname, "../../..");
const CHECK = join(ROOT, "scripts/check-pr-version.mjs");
const BUMP = join(ROOT, "scripts/bump-version.mjs");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t207-"));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "ignore" },
  );
}

const changelog = (section: string): string =>
  `# Changelog\n\n${section}## 0.1.1 — 2026-10-29\n\n- old\n`;
const SECTION = (version: string): string => `## ${version} — 2026-11-06\n\n- a change\n\n`;

function write(dir: string, files: Record<string, string>): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
}

/** a repo at 0.1.1 with a PR branch holding `files` */
function pr(files: Record<string, string>, baseVersion = "0.1.1") {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  write(dir, {
    "package.json": JSON.stringify({ version: baseVersion }),
    "CHANGELOG.md": changelog(""),
    "packages/a.ts": "a\n",
  });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "switch", "-q", "-c", "pr");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "change");
  return spawnSync("node", [CHECK, "main"], { cwd: dir, encoding: "utf8" });
}

const bumped = (version: string, section = SECTION(version)) => ({
  "package.json": JSON.stringify({ version }),
  "CHANGELOG.md": changelog(section),
});

test("a code PR without a version bump fails and says what to run", () => {
  const result = pr({ "packages/a.ts": "b\n" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("0.1.1");
  expect(result.stderr).toContain("bump-version.mjs");
});

test("a code PR with a bump and a CHANGELOG section passes", () => {
  expect(pr({ "packages/a.ts": "b\n", ...bumped("0.1.2") }).status).toBe(0);
});

test("the version compares as numbers, not text", () => {
  expect(pr({ "packages/a.ts": "b\n", ...bumped("0.1.10") }, "0.1.9").status).toBe(0);
});

test("a version that doesn't move up fails", () => {
  expect(pr({ "packages/a.ts": "b\n", ...bumped("0.1.0") }).status).toBe(1);
});

test("a bump without its CHANGELOG section fails", () => {
  const result = pr({
    "packages/a.ts": "b\n",
    "package.json": JSON.stringify({ version: "0.1.2" }),
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("## 0.1.2");
});

test("an empty CHANGELOG section fails", () => {
  const result = pr({ "packages/a.ts": "b\n", ...bumped("0.1.2", "## 0.1.2 — 2026-11-06\n\n") });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("empty");
});

test("an undated heading or an Unreleased section above it fails", () => {
  expect(pr({ "packages/a.ts": "b\n", ...bumped("0.1.2", "## 0.1.2\n\n- a\n\n") }).status).toBe(1);
  expect(
    pr({
      "packages/a.ts": "b\n",
      ...bumped("0.1.2", `## Unreleased\n\n- b\n\n${SECTION("0.1.2")}`),
    }).status,
  ).toBe(1);
});

test("a PR that only touches infra and CI is exempt", () => {
  const result = pr({
    ".github/workflows/ci.yml": "name: ci\n",
    "scripts/tool.mjs": "// x\n",
    "AGENTS.md": "# a\n",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("infra");
});

test("infra mixed with anything else is not exempt, docs included", () => {
  expect(pr({ ".github/workflows/ci.yml": "x\n", "packages/a.ts": "b\n" }).status).toBe(1);
  expect(pr({ "docs/page.md": "# p\n" }).status).toBe(1);
  expect(pr({ "README.md": "# r\n" }).status).toBe(1);
});

function runBump(cwd: string, ...args: string[]) {
  return spawnSync("node", [BUMP, ...args], { cwd, encoding: "utf8" });
}

/** the real surfaces, copied so the bump can't touch the working tree */
function surfacesCopy(): { dir: string; files: string[]; version: string } {
  const version = (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }
  ).version;
  const files = runBump(ROOT, "--list").stdout.trim().split("\n");
  const dir = tempDir();
  for (const file of [...files, "CHANGELOG.md"]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(dir, file));
  }
  return { dir, files, version };
}

test("the bump knows every file that carries the version", () => {
  const { files, version } = surfacesCopy();
  const carrying = execFileSync(
    "git",
    ["grep", "-l", "-F", version, "--", ":!pnpm-lock.yaml", ":!CHANGELOG.md"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n");
  expect([...files].sort()).toEqual(carrying.sort());
});

test("a bump moves every surface and renames Unreleased", () => {
  const { dir, files, version } = surfacesCopy();
  write(dir, { "CHANGELOG.md": changelog("## Unreleased\n\n- pending\n\n") });
  const result = runBump(dir, "99.1.2");
  expect(result.status).toBe(0);
  for (const file of files) {
    const body = readFileSync(join(dir, file), "utf8");
    expect(body).toContain("99.1.2");
    expect(body).not.toContain(version);
  }
  const log = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  expect(log).toMatch(/^# Changelog\n\n## 99\.1\.2 — \d{4}-\d{2}-\d{2}\n\n- pending\n/);
  expect(log).not.toContain("Unreleased");
});

test("a bump without Unreleased starts an empty section, which CI won't accept until written", () => {
  const { dir } = surfacesCopy();
  write(dir, { "CHANGELOG.md": changelog("") });
  expect(runBump(dir, "99.1.2").status).toBe(0);
  expect(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).toMatch(
    /^# Changelog\n\n## 99\.1\.2 — \d{4}-\d{2}-\d{2}\n\n## 0\.1\.1/,
  );
});

test("patch, minor and major step from the current version; going backwards is refused", () => {
  const { dir, version } = surfacesCopy();
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  expect(runBump(dir, "--dry-run", "patch").stdout).toContain(`${major}.${minor}.${patch + 1}`);
  expect(runBump(dir, "--dry-run", "minor").stdout).toContain(`${major}.${minor + 1}.0`);
  expect(runBump(dir, "--dry-run", "major").stdout).toContain(`${major + 1}.0.0`);
  const backwards = runBump(dir, "0.0.1");
  expect(backwards.status).toBe(1);
  expect(backwards.stderr).toContain("0.0.1");
});
