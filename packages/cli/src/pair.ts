export interface PairDeps {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  codePhone?: string;
  fetchFn?: typeof fetch;
  print: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
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

export async function runPair(deps: PairDeps): Promise<0 | 1> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;

  const health = await bridgeJson(deps, "/health");
  if (health.connected === true) {
    deps.print("already paired");
    return 0;
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
    return 0;
  }

  const qr = await bridgeJson(deps, "/api/qr");
  const qrValue = typeof qr.qr === "string" ? qr.qr : null;
  if (qrValue !== null) {
    deps.print(`scan this QR with your phone (WhatsApp → Linked devices): ${qrValue}`);
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
