export interface ParsedArgs {
  command: string;
  flags: Record<string, string>;
  lists: Record<string, string[]>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const positionals: string[] = [];
  let command: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg.startsWith("--") && arg.includes("=")) {
      const name = arg.slice(2, arg.indexOf("="));
      const value = arg.slice(arg.indexOf("=") + 1);
      flags[name] = value;
      (lists[name] ??= []).push(value);
    } else if (arg.startsWith("--")) {
      const next = argv[index + 1];
      const name = arg.slice(2);
      const value = next === undefined || next.startsWith("--") ? "" : next;
      flags[name] = value;
      (lists[name] ??= []).push(value);
      if (value !== "") {
        index += 1;
      }
    } else if (command === undefined) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { command: command ?? "help", flags, lists, positionals };
}

export interface HealthPayload {
  status?: string;
  connected?: boolean;
  loggedIn?: boolean;
  version?: string;
  uptime?: number;
}

export interface StatusSummary {
  connected: boolean;
  loggedIn: boolean;
  version: string;
  uptimeSeconds: number;
  raw: HealthPayload;
}

export function buildStatusSummary(health: HealthPayload): StatusSummary {
  return {
    connected: health.connected === true,
    loggedIn: health.loggedIn === true,
    version: health.version ?? "unknown",
    uptimeSeconds: typeof health.uptime === "number" ? health.uptime : 0,
    raw: health,
  };
}
