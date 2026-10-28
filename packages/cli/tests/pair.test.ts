import { expect, test, vi } from "vite-plus/test";
import { runPair, type PairDeps } from "../src/pair.ts";

function makeDeps(overrides: Partial<PairDeps> = {}): PairDeps & {
  writes: string[];
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
} {
  const writes: string[] = [];
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const deps: PairDeps = {
    baseUrl: "http://127.0.0.1:8080",
    token: "tok",
    timeoutMs: 10_000,
    pollIntervalMs: 0,
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      fetchCalls.push({ url: urlText, init });
      if (urlText.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
      }
      if (urlText.endsWith("/api/qr")) {
        return new Response(JSON.stringify({ qr: "QRDATA", png: "cG5n" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    print: (line: string) => {
      writes.push(line);
    },
    ...overrides,
  };
  return Object.assign(deps, { writes, fetchCalls });
}

test("already paired exits 0 without rendering", async () => {
  const deps = makeDeps({
    fetchFn: (async (url: string | URL) => {
      void url;
      return new Response(
        JSON.stringify({ status: "connected", connected: true, loggedIn: true }),
        { status: 200 },
      );
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(0);
  expect(deps.writes.some((line) => line.includes("already paired"))).toBe(true);
});

test("qr path renders the qr data and waits for connected", async () => {
  let healthCalls = 0;
  const deps = makeDeps({
    timeoutMs: 5_000,
    pollIntervalMs: 0,
    fetchFn: (async (url: string | URL) => {
      const urlText = String(url);
      if (urlText.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls <= 2) {
          return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ status: "connected", connected: true, loggedIn: true }),
          { status: 200 },
        );
      }
      if (urlText.endsWith("/api/qr")) {
        return new Response(JSON.stringify({ qr: "QRDATA", png: "cG5n" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(0);
  expect(deps.writes.some((line) => line.includes("QRDATA"))).toBe(true);
  expect(deps.writes.some((line) => line.includes("paired") || line.includes("connected"))).toBe(
    true,
  );
});

test("qr path renders an ANSI qr through the injected renderer and keeps the url line", async () => {
  const rendered: string[] = [];
  let healthCalls = 0;
  const deps = makeDeps({
    renderQr: async (text: string) => {
      rendered.push(text);
      return `[ANSI-ART:${text}]`;
    },
    fetchFn: (async (url: string | URL) => {
      const urlText = String(url);
      if (urlText.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls <= 1) {
          return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ status: "connected", connected: true, loggedIn: true }),
          { status: 200 },
        );
      }
      if (urlText.endsWith("/api/qr")) {
        return new Response(JSON.stringify({ qr: "QRDATA", png: "cG5n" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(0);
  expect(rendered).toEqual(["QRDATA"]);
  expect(deps.writes.some((line) => line.includes("[ANSI-ART:QRDATA]"))).toBe(true);
  expect(deps.writes.some((line) => line.trim().endsWith("QRDATA"))).toBe(true);
});

test("default renderer draws a terminal qr for the real wa.me url", async () => {
  // half-block output; a legacy Windows console (no WT_SESSION) gets ASCII cells
  vi.stubEnv("WT_SESSION", "test");
  const deps = makeDeps({
    fetchFn: (async (url: string | URL) => {
      const urlText = String(url);
      if (urlText.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
      }
      if (urlText.endsWith("/api/qr")) {
        return new Response(
          JSON.stringify({
            qr: "https://wa.me/settings/linked_devices#REF,KEY1,KEY2,KEY3,4",
            png: "cG5n",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    timeoutMs: 10,
    pollIntervalMs: 0,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(1);
  const qrBlock = deps.writes.find((line) => line.includes("▀"));
  expect(qrBlock).toBeDefined();
  expect(deps.writes.some((line) => line.includes("wa.me/settings/linked_devices"))).toBe(true);
});

test("code path prints the formatted pairing code and waits for pairing", async () => {
  let healthCalls = 0;
  const deps = makeDeps({
    codePhone: "358497773518",
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.endsWith("/api/pairing-code")) {
        void init;
        return new Response(JSON.stringify({ code: "ABCD-1234" }), { status: 200 });
      }
      if (urlText.endsWith("/health")) {
        healthCalls += 1;
        return new Response(JSON.stringify({ status: "qr", connected: healthCalls >= 2 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(0);
  expect(deps.writes.some((line) => line.includes("ABCD-1234"))).toBe(true);
  expect(deps.writes.some((line) => line.includes("paired"))).toBe(true);
});

test("timeout exits 1 with a hint", async () => {
  const deps = makeDeps({ timeoutMs: 0, pollIntervalMs: 0 });
  const exit = await runPair(deps);
  expect(exit).toBe(1);
  expect(deps.writes.some((line) => line.includes("timed out") || line.includes("timeout"))).toBe(
    true,
  );
});

test("pair refuses with an explanation when the bridge is pairing-blocked (T46)", async () => {
  const deps = makeDeps({
    fetchFn: (async (url: string | URL) => {
      void url;
      return new Response(
        JSON.stringify({
          status: "pairing-blocked",
          connected: false,
          loggedIn: false,
          pairingBlocked: true,
          pairingAttempts: { used: 3, limit: 3 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(1);
  const explanation = deps.writes.join("\n");
  expect(explanation).toContain("pairing attempts exhausted");
  expect(explanation).toContain("anti-abuse");
  expect(explanation).toContain("pair/resume");
  expect(deps.fetchCalls.some((call) => call.url.endsWith("/api/qr"))).toBe(false);
});

test("bridge down: explains unreachability with the url and exits 2 (T47)", async () => {
  const deps = makeDeps({
    fetchFn: (async (url: string | URL) => {
      void url;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(2);
  const explanation = deps.writes.join("\n");
  expect(explanation).toContain("bridge unreachable at http://127.0.0.1:8080");
  expect(explanation).toContain("is the daemon running?");
  expect(explanation).toContain("wa-mcp start");
});

test("an unpaired daemon gets ONE registration started, then the QR is drawn", async () => {
  let healthCalls = 0;
  let starts = 0;
  const deps = makeDeps({
    renderQr: async (text: string) => `[QR:${text}]`,
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.endsWith("/health")) {
        healthCalls += 1;
        return new Response(
          JSON.stringify(
            healthCalls >= 3
              ? { status: "connected", connected: true }
              : { status: "unpaired", connected: false },
          ),
          { status: 200 },
        );
      }
      if (urlText.endsWith("/api/pair/start")) {
        expect(init?.method).toBe("POST");
        starts += 1;
        return new Response(JSON.stringify({ started: true, status: "connecting" }), {
          status: 200,
        });
      }
      if (urlText.endsWith("/api/qr")) {
        return new Response(
          JSON.stringify({ qr: "QRDATA", index: 1, expiresAt: new Date().toISOString() }),
          {
            status: 200,
          },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(0);
  expect(starts).toBe(1);
  expect(deps.writes.some((line) => line.includes("[QR:QRDATA]"))).toBe(true);
  expect(deps.writes.some((line) => line.includes("(code 1)"))).toBe(true);
});

test("each rotated code is drawn once, as it arrives", async () => {
  const codes = ["QR-1", "QR-1", "QR-2", "QR-2"];
  let qrCalls = 0;
  let healthCalls = 0;
  const rendered: string[] = [];
  const deps = makeDeps({
    renderQr: async (text: string) => {
      rendered.push(text);
      return `[QR:${text}]`;
    },
    fetchFn: (async (url: string | URL) => {
      const urlText = String(url);
      if (urlText.endsWith("/health")) {
        healthCalls += 1;
        return new Response(
          JSON.stringify(
            healthCalls > 4
              ? { status: "connected", connected: true }
              : { status: "qr", connected: false },
          ),
          { status: 200 },
        );
      }
      if (urlText.endsWith("/api/qr")) {
        const qr = codes[Math.min(qrCalls, codes.length - 1)];
        qrCalls += 1;
        return new Response(JSON.stringify({ qr }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  expect(await runPair(deps)).toBe(0);
  expect(rendered).toEqual(["QR-1", "QR-2"]);
});

test("when the codes expire unscanned the CLI stops with advice instead of re-registering", async () => {
  let starts = 0;
  const deps = makeDeps({
    fetchFn: (async (url: string | URL) => {
      const urlText = String(url);
      if (urlText.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
      }
      if (urlText.endsWith("/api/pair/start")) {
        starts += 1;
        return new Response(JSON.stringify({ started: true }), { status: 200 });
      }
      if (urlText.endsWith("/api/qr")) {
        return new Response(JSON.stringify({ error: { code: "QR_EXPIRED", message: "expired" } }), {
          status: 410,
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  expect(await runPair(deps)).toBe(1);
  expect(deps.writes.join("\n")).toContain("expired unscanned");
  expect(starts).toBe(0);
});

test("#245 — a refused pairing-code request prints the reason and exits instead of waiting forever", async () => {
  let healthPolls = 0;
  const deps = makeDeps({
    codePhone: "358497773518",
    fetchFn: (async (url: string | URL) => {
      const urlText = String(url);
      if (urlText.endsWith("/health")) {
        healthPolls += 1;
        return new Response(JSON.stringify({ status: "logged-out", connected: false }), {
          status: 200,
        });
      }
      if (urlText.endsWith("/api/pairing-code")) {
        return new Response(
          JSON.stringify({
            error: { code: "PAIRING_BLOCKED", message: "cannot start pairing: pairing-blocked" },
          }),
          { status: 429 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  });
  expect(await runPair(deps)).toBe(1);
  const out = deps.writes.join("\n");
  expect(out).toContain("PAIRING_BLOCKED");
  expect(out).not.toContain("unavailable");
  expect(out).not.toContain("waiting for your phone");
  expect(healthPolls).toBe(1);
});
