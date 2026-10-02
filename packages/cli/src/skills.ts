import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InstallSkillsOptions {
  home: string;
  sourceDir: string;
}

export interface InstallSkillsResult {
  skillDir: string;
  commandFile: string;
}

const COMMAND_MD = `---
description: WhatsApp bridge quick access
---

Use the wa-mcp MCP tools for the user's WhatsApp request. Chats: list_chats, list_messages, search_messages. Sending: send_message, send_media, send_voice_note. Groups: create_group, update_group_participants. Run \`wa-mcp doctor\` when something is down.
`;

export function installSkills(options: InstallSkillsOptions): InstallSkillsResult {
  const skillTarget = join(options.home, ".claude", "skills", "wa-mcp");
  mkdirSync(skillTarget, { recursive: true });
  cpSync(options.sourceDir, skillTarget, { recursive: true });
  const commandsDir = join(options.home, ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });
  const commandFile = join(commandsDir, "wa-mcp.md");
  writeFileSync(commandFile, COMMAND_MD);
  void existsSync;
  return { skillDir: skillTarget, commandFile };
}
