export interface ParsedArgs {
  command: string;
  flags: Record<string, string>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  let command: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg.startsWith("--")) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[arg.slice(2)] = "";
        continue;
      }
      flags[arg.slice(2)] = next;
      index += 1;
    } else if (command === undefined) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { command: command ?? "help", flags, positionals };
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
