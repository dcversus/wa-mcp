import { expect, test } from "vite-plus/test";
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
  const qrBlock = deps.writes.find((line) => line.includes("▄") || line.includes("█"));
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
