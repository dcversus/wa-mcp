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

test("code path prints the formatted pairing code", async () => {
  const deps = makeDeps({
    codePhone: "358497773518",
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.endsWith("/api/pairing-code")) {
        void init;
        return new Response(JSON.stringify({ code: "ABCD-1234" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(0);
  expect(deps.writes.some((line) => line.includes("ABCD-1234"))).toBe(true);
});

test("timeout exits 1 with a hint", async () => {
  const deps = makeDeps({ timeoutMs: 0, pollIntervalMs: 0 });
  const exit = await runPair(deps);
  expect(exit).toBe(1);
  expect(deps.writes.some((line) => line.includes("timed out") || line.includes("timeout"))).toBe(
    true,
  );
});
