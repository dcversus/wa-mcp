import { DEFAULT_PORT } from "./defaults.ts";

export type CliGroup = "whatsapp" | "agents" | "daemon";

export interface CliCommand {
  name: string;
  group: CliGroup;
  usage: string;
  summary: string;
  actions?: string[];
  web?: string;
}

export const CLI_GROUP_LABELS: Record<CliGroup, string> = {
  whatsapp: "WhatsApp",
  agents: "Agents",
  daemon: "Daemon and setup",
};

export const CLI_GLOBAL_FLAGS = `--data-dir <dir> · --bridge-url <url> · --port <n> (default ${DEFAULT_PORT}) · --token <token> · --home <dir>`;

export const CLI_COMMANDS: readonly CliCommand[] = [
  {
    name: "chats",
    group: "whatsapp",
    usage: "chats [--q <text>] [--limit <n>]",
    summary: "your chats with unread counts — find a chat id for send, messages or subs",
    web: "#/subscriptions",
  },
  {
    name: "send",
    group: "whatsapp",
    usage: "send --chat <jid|phone> --text <text> [--reply-to <message-id>]",
    summary: "send a message — humanisation and send limits apply",
    web: "#/contacts",
  },
  {
    name: "messages",
    group: "whatsapp",
    usage:
      "messages --chat <jid|name> --around <message-id> [--limit <n>] | messages [--chat <jid|name>] [--person <jid>] [--from <date>] [--to <date>] [--direction in|out] [--q <text>] [--agent <slug>] [--limit <n>] [--follow]",
    summary: "message log (the web UI's Logs page); --around shows one message in context",
    web: "#/logs",
  },
  {
    name: "media",
    group: "whatsapp",
    usage: "media download <message-id> | media transcribe <message-id>",
    summary: "save a message's photo, video, voice note or document; transcribe a voice note",
    actions: ["download", "transcribe"],
    web: "#/contacts",
  },
  {
    name: "contacts",
    group: "whatsapp",
    usage:
      "contacts [--q <text>] [--saved] [--limit <n>] | contacts add <phone> --name <name> [--username <u>] | contacts rename <phone|jid> --name <name> | contacts remove <phone|jid> | contacts sync [--dry-run]",
    summary: "your WhatsApp contacts; writes sync to the account like WhatsApp Web",
    actions: ["list", "add", "rename", "remove", "sync"],
    web: "#/contacts",
  },
  {
    name: "profile",
    group: "whatsapp",
    usage:
      "profile | profile name <name> | profile about <text> | profile privacy <setting> <value> | profile blocked | profile block <phone|jid> | profile unblock <phone|jid>",
    summary: "your name, about text, privacy settings and blocked contacts",
    actions: ["show", "name", "about", "privacy", "blocked", "block", "unblock"],
    web: "#/profile",
  },
  {
    name: "status",
    group: "whatsapp",
    usage: "status",
    summary: "bridge status, plus today's sent/received counts and reconnects",
    web: "#/connection",
  },
  {
    name: "settings",
    group: "whatsapp",
    usage:
      "settings [get] | settings set [--humanise on|off] [--min-delay <ms>] [--max-delay <ms>] [--per-char <ms>] [--typing on|off] [--limits on|off] [--per-minute <n>] [--per-hour <n>] [--per-day <n>] [--per-chat-day <n|off>]",
    summary:
      "connection settings: human-like reply delay + typing status, send limits (anti-ban; both off by default)",
    actions: ["get", "set"],
    web: "#/connection",
  },
  {
    name: "pair",
    group: "whatsapp",
    usage: "pair [--code <phone>] [--timeout <ms>] | pair --resume",
    summary:
      "link this computer to WhatsApp by QR or phone-number code; --resume lifts a pairing block",
    web: "#/pairing",
  },
  {
    name: "unlink",
    group: "whatsapp",
    usage: "unlink --yes",
    summary: "sign this computer out of WhatsApp (you will need to link again)",
    web: "#/pairing",
  },
  {
    name: "subs",
    group: "agents",
    usage:
      "subs [list] | subs create --name <n> (--chat <jid>… | --all-chats) [--like %text%] [--mention-only] [--prompt <text>] [--delivery inbox|session|spawn] [--session <id>] [--command <path> --arg <a>… --env K=V…] [--disable] | subs edit <id> [same flags, --enable] | subs delete <id> | subs test <id> | subs sessions",
    summary: "subscriptions (the web UI's Subscriptions page)",
    actions: ["list", "create", "edit", "delete", "test", "sessions"],
    web: "#/subscriptions",
  },
  {
    name: "connections",
    group: "agents",
    usage: "connections | connections disconnect <hooks|mcp> <agent> [--sub <id>]",
    summary: "connected agents (hooks + MCP registrations); disconnect removes only wa-mcp entries",
    actions: ["list", "disconnect"],
    web: "#/agents",
  },
  {
    name: "install",
    group: "agents",
    usage:
      "install [--target <platform>…] [--dry-run] | install --hooks claude|codex --sub <id> [--remove] | install --service",
    summary:
      "register the MCP server with your agents, install subscription hooks, or a login service",
  },
  {
    name: "inbox",
    group: "agents",
    usage: "inbox drain --inbox <path> [--state <path>]",
    summary: "read new events from a subscription inbox (exit 2 = new events)",
  },
  {
    name: "subscribe",
    group: "agents",
    usage: "subscribe (--chat <jid> | --all) [--kind message]",
    summary: "quick inbox subscription (same as subs create with inbox delivery)",
    web: "#/subscriptions",
  },
  {
    name: "unsubscribe",
    group: "agents",
    usage: "unsubscribe <subscription-id>",
    summary: "delete a subscription (same as subs delete)",
    web: "#/subscriptions",
  },
  {
    name: "skills",
    group: "agents",
    usage: "skills install",
    summary: "install the wa-mcp agent skill and slash command",
  },
  {
    name: "uninstall",
    group: "agents",
    usage: "uninstall [--target <platform>…] [--service] [--purge [--yes]]",
    summary: "remove agent registrations, the login service, and optionally the data dir",
  },
  {
    name: "start",
    group: "daemon",
    usage: "start [--port <n>]",
    summary: "start the bridge daemon in the background",
  },
  {
    name: "stop",
    group: "daemon",
    usage: "stop",
    summary: "stop the bridge daemon",
  },
  {
    name: "restart",
    group: "daemon",
    usage: "restart [--port <n>]",
    summary: "restart the bridge daemon",
  },
  {
    name: "logs",
    group: "daemon",
    usage: "logs [--follow]",
    summary: "daemon log (bridge.log)",
  },
  {
    name: "doctor",
    group: "daemon",
    usage: "doctor [--engines]",
    summary: "check Node, the daemon, registrations and (with --engines) transcription engines",
  },
  {
    name: "config",
    group: "daemon",
    usage: "config [list] | config get <key> | config set <key> <value> | config unset <key>",
    summary: "daemon config file: transcription engine, base URL, model and key",
  },
  {
    name: "import",
    group: "daemon",
    usage: "import --from lharries|gofork --path <dir> [--dry-run]",
    summary: "import message history from another WhatsApp MCP store",
  },
  {
    name: "update",
    group: "daemon",
    usage: "update",
    summary: "show the installed version and how to update",
  },
  {
    name: "voice",
    group: "daemon",
    usage:
      "voice install [--bin-dir <dir>] [--bridge-url <url>] [--token <t>] [--force] | voice uninstall [--bin-dir <dir>] | voice test [--bin-dir <dir>]",
    summary:
      "install the /voice dictation shims — Claude Code transcribes WhatsApp voice notes through its rec/sox fallback",
    actions: ["install", "uninstall", "test"],
  },
];

export function cliUsageLines(): string[] {
  return [
    `wa-mcp — usage: wa-mcp <${CLI_COMMANDS.map((command) => command.name).join("|")}> [command flags]`,
    `  global flags: ${CLI_GLOBAL_FLAGS}`,
    ...CLI_COMMANDS.map((command) => `  ${command.usage} — ${command.summary}`),
  ];
}
