import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const SKILL_PATH = join(
  import.meta.dirname ?? ".",
  "..",
  "..",
  "..",
  "skills",
  "wa-mcp",
  "SKILL.md",
);

test("SKILL.md has valid frontmatter with name and description", () => {
  const skill = readFileSync(SKILL_PATH, "utf8").replace(/\r\n/g, "\n");
  const frontmatter = skill.split("---\n")[1] ?? "";
  expect(frontmatter).toContain("name: wa-mcp");
  expect(frontmatter).toMatch(/description: .+WhatsApp/i);
});

test("SKILL.md documents the env vars and quickstart", () => {
  const skill = readFileSync(SKILL_PATH, "utf8");
  expect(skill).toContain("WA_BRIDGE_URL");
  expect(skill).toContain("WA_TOKEN");
  expect(skill).toContain("install");
  expect(skill).toContain("pair");
});

test("SKILL.md groups all thirty tools", () => {
  const skill = readFileSync(SKILL_PATH, "utf8");
  const tools = [
    "send_message",
    "list_chats",
    "list_messages",
    "search_messages",
    "get_message_context",
    "send_media",
    "get_chat",
    "send_reaction",
    "edit_message",
    "forward_message",
    "mark_chat_read",
    "set_chat_state",
    "list_contacts",
    "set_alias",
    "get_unread_counts",
    "update_profile",
    "set_privacy",
    "block_unblock",
    "get_blocklist",
    "get_media",
    "list_notification_rules",
    "add_notification_rule",
    "delete_notification_rule",
    "create_group",
    "update_group_participants",
    "update_group_meta",
    "leave_group",
    "get_group_invite",
    "transcribe_message",
    "send_voice_note",
  ];
  const missing = tools.filter((tool) => !skill.includes(tool));
  expect(missing).toEqual([]);
});

test("references/tools.md and troubleshooting.md exist with content", () => {
  const base = join(import.meta.dirname ?? ".", "..", "..", "..", "skills", "wa-mcp", "references");
  const tools = readFileSync(join(base, "tools.md"), "utf8");
  const troubleshooting = readFileSync(join(base, "troubleshooting.md"), "utf8");
  expect(tools).toContain("send_message");
  expect(tools).toContain("input schema");
  expect(troubleshooting).toContain("pairing");
  expect(troubleshooting).toContain("UNAUTHORIZED");
});
