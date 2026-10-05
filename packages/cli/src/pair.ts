export interface PairDeps {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  codePhone?: string;
  fetchFn?: typeof fetch;
  print: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  renderQr?: (text: string) => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_MS = 2_000;

async function bridgeJson(
  deps: PairDeps,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const fetchFn = deps.fetchFn ?? fetch;
  const response = await fetchFn(`${deps.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${deps.token}` },
    ...init,
  });
  return (await response.json()) as Record<string, unknown>;
}

export async function runPair(deps: PairDeps): Promise<0 | 1 | 2> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  let health: Record<string, unknown>;
  try {
    health = await bridgeJson(deps, "/health");
  } catch {
    deps.print(
      `bridge unreachable at ${deps.baseUrl} — is the daemon running? start it with: wa-mcp start (or node packages/bridge/dist/bin.mjs)`,
    );
    return 2;
  }
  if (health.connected === true) {
    deps.print("already paired");
    return 0;
  }

  if (health.pairingBlocked === true) {
    const attempts = health.pairingAttempts as { used?: number; limit?: number } | undefined;
    deps.print(
      `pairing attempts exhausted — ${attempts?.used ?? "?"} of ${attempts?.limit ?? "?"} registrations without pairing; refusing to render a QR.`,
    );
    deps.print(
      "WhatsApp's anti-abuse cooldown resets on every attempt, so retrying now deepens the lockout. Wait for the cooldown to clear, then restart the daemon or POST /api/pair/resume, and run 'wa-mcp pair' again.",
    );
    return 1;
  }

  if (deps.codePhone !== undefined) {
    const payload = await bridgeJson(deps, "/api/pairing-code", {
      method: "POST",
      body: JSON.stringify({ phone: deps.codePhone }),
    });
    const code = typeof payload.code === "string" ? payload.code : "unavailable";
    deps.print(`pairing code: ${code}`);
    deps.print(
      "enter this code on your phone: WhatsApp → Linked devices → Link with phone number instead",
    );
    deps.print("waiting for your phone to enter the code…");
  } else {
    const qr = await bridgeJson(deps, "/api/qr");
    const qrValue = typeof qr.qr === "string" ? qr.qr : null;
    if (qrValue !== null) {
      const renderQr =
        deps.renderQr ??
        (async (text: string) => {
          const { default: QRCode } = await import("qrcode");
          return QRCode.toString(text, { type: "terminal", small: true });
        });
      deps.print("scan this QR with your phone (WhatsApp → Linked devices):");
      deps.print(await renderQr(qrValue));
      deps.print(`or paste this link on your phone to link without scanning: ${qrValue}`);
    }
  }

  while (Date.now() < deadline) {
    const healthNow = await bridgeJson(deps, "/health");
    if (healthNow.connected === true) {
      deps.print("paired: bridge connected to WhatsApp");
      return 0;
    }
    if (pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }
  }

  deps.print(`pairing timed out after ${timeoutMs}ms — run 'wa-mcp pair' again for a fresh QR`);
  return 1;
}
