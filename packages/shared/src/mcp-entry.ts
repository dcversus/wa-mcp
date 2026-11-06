/** The name we register under; the host's user may have renamed it since. */
export const MCP_SERVER_KEY = "wa-mcp";

/** Ours under any name: a stdio entry carries our bin or --bridge-url in its
 * command or args, a URL entry carries our agent header. */
export function isWaMcpServerEntry(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const { args, command, headers } = entry as Record<string, unknown>;
  const carriesBridge =
    Array.isArray(args) &&
    args.some((arg) => typeof arg === "string" && /wa-mcp|--bridge-url/.test(arg));
  return (
    carriesBridge ||
    (typeof command === "string" && command.includes("wa-mcp")) ||
    (headers !== null && typeof headers === "object" && "X-WA-Agent" in headers)
  );
}

/** The key a host holds our entry under, or the one to add it as. */
export function waMcpServerKey(servers: Record<string, unknown>): string {
  if (Object.hasOwn(servers, MCP_SERVER_KEY)) {
    return MCP_SERVER_KEY;
  }
  return Object.keys(servers).find((key) => isWaMcpServerEntry(servers[key])) ?? MCP_SERVER_KEY;
}
