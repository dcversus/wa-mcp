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

async function bridgeCall(
  deps: PairDeps,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const response = await fetchFn(`${deps.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${deps.token}` },
    ...init,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function bridgeJson(
  deps: PairDeps,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  return (await bridgeCall(deps, path, init)).body;
}

function errorText(body: Record<string, unknown>): string {
  const error = body.error as { code?: unknown; message?: unknown } | undefined;
  if (error === undefined) {
    return typeof body.reason === "string" ? body.reason : "no details";
  }
  const code = typeof error.code === "string" ? error.code : "ERROR";
  const message = typeof error.message === "string" ? error.message : "";
  return `${code}: ${message}`;
}

async function defaultRenderQr(text: string): Promise<string> {
  const { default: QRCode } = await import("qrcode");
  const { renderQrTerminal } = await import("@wa-mcp/shared");
  const qr = QRCode.create(text, { errorCorrectionLevel: "L" });
  // legacy Windows consoles can't draw block glyphs (Windows Terminal sets WT_SESSION)
  const ascii = process.platform === "win32" && process.env.WT_SESSION === undefined;
  return renderQrTerminal({ size: qr.modules.size, data: qr.modules.data }, { ascii });
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
    const { status, body } = await bridgeCall(deps, "/api/pairing-code", {
      method: "POST",
      body: JSON.stringify({ phone: deps.codePhone }),
    });
    if (status !== 200 || typeof body.code !== "string") {
      deps.print(`pairing code refused — ${errorText(body)}`);
      return 1;
    }
    deps.print(`pairing code: ${body.code}`);
    deps.print(
      "enter this code on your phone: WhatsApp → Linked devices → Link with phone number instead",
    );
    deps.print("waiting for your phone to enter the code…");
  } else if (health.status === "unpaired" || health.status === "logged-out") {
    // a person is at the terminal: this is the moment to register
    const { status, body } = await bridgeCall(deps, "/api/pair/start", { method: "POST" });
    if (status !== 200) {
      deps.print(`could not start pairing — ${errorText(body)}`);
      return 1;
    }
  }

  const renderQr = deps.renderQr ?? defaultRenderQr;
  let shown: string | null = null;
  while (Date.now() < deadline) {
    if (deps.codePhone === undefined) {
      const { status, body } = await bridgeCall(deps, "/api/qr");
      if (status === 410) {
        deps.print(
          "the QR codes expired unscanned and registration stopped. Run 'wa-mcp pair' again when you're at your phone.",
        );
        return 1;
      }
      const qrValue = status === 200 && typeof body.qr === "string" ? body.qr : null;
      if (qrValue !== null && qrValue !== shown) {
        shown = qrValue;
        const position = typeof body.index === "number" ? ` (code ${body.index})` : "";
        const until =
          typeof body.expiresAt === "string"
            ? ` — scan before ${new Date(body.expiresAt).toLocaleTimeString()}`
            : "";
        deps.print(`scan this QR with your phone (WhatsApp → Linked devices)${position}${until}:`);
        deps.print(await renderQr(qrValue));
        deps.print(`or open this link on your phone to link without scanning: ${qrValue}`);
      }
    }
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
