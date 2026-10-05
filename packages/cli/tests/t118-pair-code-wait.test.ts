import { expect, test } from "vite-plus/test";
import { runPair, type PairDeps } from "../src/pair.ts";

function makeDeps(overrides: Partial<PairDeps> = {}): PairDeps & { writes: string[] } {
  const writes: string[] = [];
  let healthCalls = 0;
  const deps: PairDeps = {
    baseUrl: "http://127.0.0.1:8080",
    token: "tok",
    timeoutMs: 10_000,
    pollIntervalMs: 0,
    codePhone: "358497773518",
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      void init;
      const urlText = String(url);
      if (urlText.endsWith("/api/pairing-code")) {
        return new Response(JSON.stringify({ code: "ABCD-1234" }), { status: 200 });
      }
      if (urlText.endsWith("/health")) {
        healthCalls += 1;
        return new Response(JSON.stringify({ status: "qr", connected: healthCalls >= 3 }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    print: (line: string) => {
      writes.push(line);
    },
    ...overrides,
  };
  return Object.assign(deps, { writes });
}

test("code path waits for the phone to enter the code, then reports paired", async () => {
  const deps = makeDeps();
  const exit = await runPair(deps);
  expect(exit).toBe(0);
  expect(deps.writes.some((line) => line.includes("ABCD-1234"))).toBe(true);
  expect(deps.writes.some((line) => line.includes("paired"))).toBe(true);
});

test("code path exits 1 with a hint when the code is never entered", async () => {
  const deps = makeDeps({
    timeoutMs: 0,
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      void init;
      const urlText = String(url);
      if (urlText.endsWith("/api/pairing-code")) {
        return new Response(JSON.stringify({ code: "ABCD-1234" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "qr", connected: false }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  const exit = await runPair(deps);
  expect(exit).toBe(1);
  expect(deps.writes.some((line) => line.includes("ABCD-1234"))).toBe(true);
  expect(deps.writes.some((line) => line.includes("timed out"))).toBe(true);
});
