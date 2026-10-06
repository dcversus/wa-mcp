import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface InstallSkillsOptions {
  home: string;
  sourceDir: string;
  dataDir?: string;
}

export interface InstallSkillsResult {
  skillDir: string;
  commandFile: string;
  mirrored: string[];
}

const COMMAND_MD = `---
description: WhatsApp bridge quick access
---

Use the wa-mcp MCP tools for the user's WhatsApp request. Chats: list_chats, list_messages, search_messages. Sending: send_message, send_media, send_voice_note. Groups: create_group, update_group_participants. Run \`wa-mcp doctor\` when something is down.
`;

export function installSkills(options: InstallSkillsOptions): InstallSkillsResult {
  const skillTarget = join(options.home, ".claude", "skills", "wa-mcp");
  rmSync(skillTarget, { recursive: true, force: true });
  mkdirSync(skillTarget, { recursive: true });
  cpSync(options.sourceDir, skillTarget, { recursive: true });
  const mirrored: string[] = [];
  if (options.dataDir !== undefined) {
    const dataMirror = join(options.dataDir, "skills", "wa-mcp");
    rmSync(dataMirror, { recursive: true, force: true });
    mkdirSync(dataMirror, { recursive: true });
    cpSync(options.sourceDir, dataMirror, { recursive: true });
    mirrored.push(dataMirror);
  }
  const piMirror = join(options.home, ".pi", "skills", "wa-mcp");
  rmSync(piMirror, { recursive: true, force: true });
  mkdirSync(piMirror, { recursive: true });
  cpSync(options.sourceDir, piMirror, { recursive: true });
  mirrored.push(piMirror);
  const mediaSource = join(options.sourceDir, "..", "wa-media");
  if (existsSync(mediaSource)) {
    const mediaTargets = [
      join(options.home, ".claude", "skills", "wa-media"),
      join(options.home, ".pi", "skills", "wa-media"),
    ];
    if (options.dataDir !== undefined) {
      mediaTargets.push(join(options.dataDir, "skills", "wa-media"));
    }
    for (const mediaTarget of mediaTargets) {
      rmSync(mediaTarget, { recursive: true, force: true });
      mkdirSync(mediaTarget, { recursive: true });
      cpSync(mediaSource, mediaTarget, { recursive: true });
      mirrored.push(mediaTarget);
    }
  }
  const commandsDir = join(options.home, ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });
  const commandFile = join(commandsDir, "wa-mcp.md");
  writeFileSync(commandFile, COMMAND_MD);
  void existsSync;
  return { skillDir: skillTarget, commandFile, mirrored };
}
