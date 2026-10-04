import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { installSkills } from "../src/skills.ts";

function repoSkillDir(): string {
  return join(__dirname_fix(), "skills", "wa-mcp");
}

function __dirname_fix(): string {
  return join(import.meta.dirname ?? ".", "..", "..", "..");
}

test("installSkills copies SKILL.md and references into ~/.claude/skills/wa-mcp", () => {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-skills-"));
  const result = installSkills({ home, sourceDir: repoSkillDir() });
  expect(result.skillDir).toBe(join(home, ".claude", "skills", "wa-mcp"));
  expect(existsSync(join(result.skillDir, "SKILL.md"))).toBe(true);
  expect(existsSync(join(result.skillDir, "references", "tools.md"))).toBe(true);
  expect(existsSync(join(result.skillDir, "references", "troubleshooting.md"))).toBe(true);
  const skill = readFileSync(join(result.skillDir, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  expect(skill.startsWith("---\n")).toBe(true);
  expect(skill).toContain("name: wa-mcp");
});

test("installSkills writes the claude-code slash command", () => {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-skills-"));
  const result = installSkills({ home, sourceDir: repoSkillDir() });
  expect(result.commandFile).toContain(join(".claude", "commands", "wa-mcp.md"));
  const command = readFileSync(result.commandFile, "utf8");
  expect(command).toContain("wa-mcp");
});

test("installSkills is idempotent", () => {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-skills-"));
  installSkills({ home, sourceDir: repoSkillDir() });
  installSkills({ home, sourceDir: repoSkillDir() });
  expect(existsSync(join(home, ".claude", "skills", "wa-mcp", "SKILL.md"))).toBe(true);
});

test("T101-A — install mirrors skills to the data dir and the pi skill dir", () => {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-t101-home-"));
  const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t101-data-"));
  const result = installSkills({ home, sourceDir: repoSkillDir(), dataDir });
  // GOAL L247: skills live in ~/.wa-mcp/skills/ AND the platform skill dir
  expect(existsSync(join(dataDir, "skills", "wa-mcp", "SKILL.md"))).toBe(true);
  expect(existsSync(join(home, ".claude", "skills", "wa-mcp", "SKILL.md"))).toBe(true);
  expect(existsSync(join(home, ".pi", "skills", "wa-mcp", "SKILL.md"))).toBe(true);
  expect(result.mirrored).toEqual([
    join(dataDir, "skills", "wa-mcp"),
    join(home, ".pi", "skills", "wa-mcp"),
  ]);
});
