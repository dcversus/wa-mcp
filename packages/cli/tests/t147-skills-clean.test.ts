import { expect, test } from "vite-plus/test";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installSkills } from "../src/skills.ts";

test("installSkills removes stale files from a previous install", () => {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-t147-"));
  const source = mkdtempSync(join(tmpdir(), "wa-mcp-t147-src-"));
  mkdirSync(join(source, "references"), { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "skill v2");
  const oldSkillDir = join(home, ".claude", "skills", "wa-mcp");
  mkdirSync(join(oldSkillDir, "stale-nested-skill"), { recursive: true });
  writeFileSync(join(oldSkillDir, "stale-nested-skill", "SKILL.md"), "old");
  writeFileSync(join(oldSkillDir, "old-file.md"), "old");

  const result = installSkills({ home, sourceDir: source });

  expect(existsSync(join(result.skillDir, "stale-nested-skill"))).toBe(false);
  expect(existsSync(join(result.skillDir, "old-file.md"))).toBe(false);
  expect(existsSync(join(result.skillDir, "SKILL.md"))).toBe(true);
  expect(existsSync(join(result.skillDir, "references"))).toBe(true);
  rmSync(home, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

test("installSkills is idempotent on a clean target", () => {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-t147b-"));
  const source = mkdtempSync(join(tmpdir(), "wa-mcp-t147b-src-"));
  writeFileSync(join(source, "SKILL.md"), "skill");
  const first = installSkills({ home, sourceDir: source });
  const second = installSkills({ home, sourceDir: source });
  expect(existsSync(join(first.skillDir, "SKILL.md"))).toBe(true);
  expect(existsSync(join(second.skillDir, "SKILL.md"))).toBe(true);
  rmSync(home, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});
