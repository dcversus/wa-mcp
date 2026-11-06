import type { Platform } from "./writers.ts";

/** the names the daemon's certificate covers */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function mcpEndpoint(bridgeUrl: string, https: boolean): string {
  const url = new URL(bridgeUrl);
  url.protocol = https && LOOPBACK.has(url.hostname) ? "https:" : "http:";
  url.pathname = "/mcp";
  return url.href;
}

/** What a host needs before it can use https, or what it must already have when
 * --https was asked for. Claude Code's trust is written by install itself. */
export function httpsTrustHint(
  platform: Platform,
  url: string,
  certPath: string,
): string | undefined {
  if (platform === "claude-code") {
    return undefined;
  }
  const setup =
    platform === "codex"
      ? `export CODEX_CA_CERTIFICATE=${certPath}`
      : platform === "pi"
        ? `export NODE_EXTRA_CA_CERTS=${certPath}`
        : `add ${certPath} to your system trust store`;
  return url.startsWith("https:")
    ? `needs: ${setup} before starting ${platform}`
    : `for https: ${setup}, then re-run with --https`;
}
