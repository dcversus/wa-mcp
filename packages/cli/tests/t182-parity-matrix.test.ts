import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { CLI_COMMANDS, CLI_GLOBAL_FLAGS } from "@wa-mcp/shared";

const WEB_SRC = join(import.meta.dirname, "../../web-ui/src");

interface CliSide {
  command: string;
  action?: string;
  flag?: string;
}

interface Capability {
  capability: string;
  web: { route: string; api: string[] } | { uiOnly: string };
  cli: CliSide | { hostOnly: string };
}

const MATRIX: Capability[] = [
  {
    capability: "list chats (subscription chat picker, log chat filter)",
    web: { route: "#/subscriptions", api: ["getChats"] },
    cli: { command: "chats" },
  },
  {
    capability: "read a chat",
    web: { route: "#/chat/x", api: ["getMessages"] },
    cli: { command: "messages", flag: "--chat" },
  },
  {
    capability: "send / reply",
    web: { route: "#/chat/x", api: ["sendMessage"] },
    cli: { command: "send", flag: "--reply-to" },
  },
  {
    capability: "message in context",
    web: { route: "#/chat/x", api: ["getContext"] },
    cli: { command: "messages", flag: "--around" },
  },
  {
    capability: "download media",
    web: { route: "#/chat/x", api: ["downloadMedia"] },
    cli: { command: "media", action: "download" },
  },
  {
    capability: "transcribe a voice note",
    web: { route: "#/chat/x", api: ["transcribe"] },
    cli: { command: "media", action: "transcribe" },
  },
  {
    capability: "typing indicator while you type",
    web: { route: "#/chat/x", api: ["sendPresence"] },
    cli: { command: "settings", flag: "--typing" },
  },
  {
    capability: "message log with filters",
    web: { route: "#/logs", api: ["searchLogs"] },
    cli: { command: "messages", flag: "--direction" },
  },
  {
    capability: "live tail",
    web: { route: "#/logs", api: ["searchLogs"] },
    cli: { command: "messages", flag: "--follow" },
  },
  {
    capability: "list / search contacts",
    web: { route: "#/contacts", api: ["contacts"] },
    cli: { command: "contacts", action: "list" },
  },
  {
    capability: "add contact",
    web: { route: "#/contacts", api: ["addContact"] },
    cli: { command: "contacts", action: "add" },
  },
  {
    capability: "rename contact",
    web: { route: "#/contacts", api: ["renameContact"] },
    cli: { command: "contacts", action: "rename" },
  },
  {
    capability: "remove contact",
    web: { route: "#/contacts", api: ["removeContact"] },
    cli: { command: "contacts", action: "remove" },
  },
  {
    capability: "sync contacts from chats",
    web: { uiOnly: "automatic in the background — no button" },
    cli: { command: "contacts", action: "sync" },
  },
  {
    capability: "list connected agents",
    web: { route: "#/agents", api: ["connections"] },
    cli: { command: "connections", action: "list" },
  },
  {
    capability: "disconnect an agent",
    web: { route: "#/agents", api: ["disconnectConnection"] },
    cli: { command: "connections", action: "disconnect" },
  },
  {
    capability: "list subscriptions",
    web: { route: "#/subscriptions", api: ["subscriptions"] },
    cli: { command: "subs", action: "list" },
  },
  {
    capability: "create subscription",
    web: { route: "#/subscriptions", api: ["createSubscription"] },
    cli: { command: "subs", action: "create" },
  },
  {
    capability: "edit / switch subscription on or off",
    web: { route: "#/subscriptions", api: ["updateSubscription"] },
    cli: { command: "subs", action: "edit" },
  },
  {
    capability: "delete subscription",
    web: { route: "#/subscriptions", api: ["deleteSubscription"] },
    cli: { command: "subs", action: "delete" },
  },
  {
    capability: "send a test event",
    web: { route: "#/subscriptions", api: ["testSubscription"] },
    cli: { command: "subs", action: "test" },
  },
  {
    capability: "pick an agent session",
    web: { route: "#/subscriptions", api: ["sessions"] },
    cli: { command: "subs", action: "sessions" },
  },
  {
    capability: "show profile",
    web: { route: "#/profile", api: ["getMe", "privacy"] },
    cli: { command: "profile", action: "show" },
  },
  {
    capability: "set name",
    web: { route: "#/profile", api: ["setProfileName"] },
    cli: { command: "profile", action: "name" },
  },
  {
    capability: "set about",
    web: { route: "#/profile", api: ["setProfileStatus"] },
    cli: { command: "profile", action: "about" },
  },
  {
    capability: "privacy settings",
    web: { route: "#/profile", api: ["setPrivacy"] },
    cli: { command: "profile", action: "privacy" },
  },
  {
    capability: "list blocked",
    web: { route: "#/profile", api: ["blocklist"] },
    cli: { command: "profile", action: "blocked" },
  },
  {
    capability: "block a number",
    web: { route: "#/profile", api: ["block"] },
    cli: { command: "profile", action: "block" },
  },
  {
    capability: "unblock",
    web: { route: "#/profile", api: ["unblock"] },
    cli: { command: "profile", action: "unblock" },
  },
  {
    capability: "link status + today's stats",
    web: { route: "#/connection", api: ["getHealth", "connectionStats"] },
    cli: { command: "status" },
  },
  {
    capability: "humanisation + send limits",
    web: { route: "#/connection", api: ["connectionSettings", "saveConnectionSettings"] },
    cli: { command: "settings", action: "set" },
  },
  {
    capability: "link by QR",
    web: { route: "#/pairing", api: ["getQr"] },
    cli: { command: "pair" },
  },
  {
    capability: "link by phone-number code",
    web: { route: "#/pairing", api: ["pairingCode"] },
    cli: { command: "pair", flag: "--code" },
  },
  {
    capability: "lift a pairing block",
    web: { route: "#/pairing", api: ["resumePairing"] },
    cli: { command: "pair", flag: "--resume" },
  },
  {
    capability: "unlink this computer",
    web: { route: "#/pairing", api: ["logout"] },
    cli: { command: "unlink" },
  },
  {
    capability: "transcription engine settings",
    web: { uiOnly: "daemon config — the web panel was never rendered and is removed" },
    cli: { command: "config" },
  },
  {
    capability: "bridge address + access key",
    web: { uiOnly: "automatic — the bridge hands the web UI its key" },
    cli: { command: "status", flag: "--bridge-url" },
  },
  {
    capability: "help + command reference",
    web: { uiOnly: "#/help renders the shared CLI reference" },
    cli: { hostOnly: "`wa-mcp` with no arguments prints the same reference" },
  },
  {
    capability: "web UI sign-in",
    web: { route: "#/pairing", api: ["uiToken"] },
    cli: { hostOnly: "the CLI reads the token file" },
  },
];

const HOST_ONLY = [
  "install",
  "uninstall",
  "skills",
  "start",
  "stop",
  "restart",
  "logs",
  "doctor",
  "mcp",
  "voice",
  "import",
  "update",
  "inbox",
  "subscribe",
  "unsubscribe",
];

const api = readFileSync(join(WEB_SRC, "api.ts"), "utf8");
const routePatterns = [
  ...readFileSync(join(WEB_SRC, "app.ts"), "utf8").matchAll(/pattern: "([^"]+)"/g),
].map((match) => match[1] ?? "");

function routeExists(hash: string): boolean {
  const segments = hash.replace(/^#\//, "").split("/");
  return routePatterns.some((pattern) => {
    const parts = pattern.split("/");
    return (
      parts.length === segments.length &&
      parts.every((part, index) => part.startsWith(":") || part === segments[index])
    );
  });
}
const main = readFileSync(join(WEB_SRC, "main.ts"), "utf8");
const pairingPoll = readFileSync(join(WEB_SRC, "pairing-poll.ts"), "utf8");
const webCalls = new Set(
  [...`${main}\n${pairingPoll}`.matchAll(/client\s*\.([a-zA-Z]+)\(/g)].map((match) => match[1]),
);

test("T182 parity — every web capability has a live route and client call", () => {
  for (const row of MATRIX) {
    if ("uiOnly" in row.web) {
      continue;
    }
    expect(routeExists(row.web.route), row.capability).toBe(true);
    for (const method of row.web.api) {
      expect(api, `${row.capability}: ApiClient.${method}`).toMatch(
        new RegExp(`^  ${method}\\(`, "m"),
      );
      expect(webCalls.has(method), `${row.capability}: main.ts calls ${method}`).toBe(true);
    }
  }
});

test("T182 parity — every web capability has a CLI command, action or flag", () => {
  for (const row of MATRIX) {
    if ("hostOnly" in row.cli) {
      continue;
    }
    const { command, action, flag } = row.cli;
    const entry = CLI_COMMANDS.find((candidate) => candidate.name === command);
    expect(entry, `${row.capability}: wa-mcp ${command}`).toBeDefined();
    if (action !== undefined) {
      expect(entry?.actions ?? [], `${row.capability}: ${command} ${action}`).toContain(action);
    }
    if (flag !== undefined) {
      expect(`${entry?.usage ?? ""} ${CLI_GLOBAL_FLAGS}`, `${row.capability}: ${flag}`).toContain(
        flag,
      );
    }
  }
});

test("T182 parity — nothing escapes the matrix: every web client call and every CLI command is listed", () => {
  const listedApi = new Set(MATRIX.flatMap((row) => ("api" in row.web ? row.web.api : [])));
  for (const call of webCalls) {
    expect(listedApi.has(call as string), `web calls ${call} but the matrix does not list it`).toBe(
      true,
    );
  }
  const listedCli = new Set([
    ...MATRIX.flatMap((row) => ("command" in row.cli ? [row.cli.command] : [])),
    ...HOST_ONLY,
  ]);
  for (const command of CLI_COMMANDS) {
    expect(listedCli.has(command.name), `wa-mcp ${command.name} is not in the matrix`).toBe(true);
  }
});
