import { describe, expect, test } from "vite-plus/test";
import { resolveMedia, MediaError } from "../../src/media/resolve.ts";

/** Injectable DNS: the guard resolves every address before any fetch. */
function lookupOf(addresses: Array<{ address: string; family: number }>) {
  return async (_host: string, _opts?: unknown) => addresses;
}

describe("T73 H3 — assertPublicHttpUrl blocks private/loopback/link-local targets", () => {
  test("rejects non-http(s) schemes", async () => {
    await expect(assertUrl("file:///etc/passwd")).rejects.toHaveProperty("code", "SSRF_BLOCKED");
    await expect(assertUrl("ftp://example.com/x")).rejects.toHaveProperty("code", "SSRF_BLOCKED");
  });

  test("rejects by-name loopback without touching DNS", async () => {
    await expect(assertUrl("http://localhost/x")).rejects.toHaveProperty("code", "SSRF_BLOCKED");
    await expect(assertUrl("http://LOCALHOST:8080/x")).rejects.toHaveProperty(
      "code",
      "SSRF_BLOCKED",
    );
    await expect(assertUrl("http://[::1]/x")).rejects.toHaveProperty("code", "SSRF_BLOCKED");
  });

  const blockedAddresses = [
    ["127.0.0.1", "loopback v4"],
    ["127.8.8.8", "loopback range"],
    ["10.1.2.3", "private 10/8"],
    ["172.16.0.9", "private 172.16/12 lower"],
    ["172.31.255.1", "private 172.16/12 upper"],
    ["192.168.1.1", "private 192.168/16"],
    ["169.254.169.254", "link-local metadata"],
    ["0.0.0.0", "unspecified"],
    ["::1", "loopback v6"],
    ["fc00::1", "unique-local fc00::/7"],
    ["fe80::1", "link-local fe80::/10"],
  ] as const;

  for (const [address, label] of blockedAddresses) {
    test(`blocks resolved ${label} (${address})`, async () => {
      await expect(
        assertUrl("http://internal.example/x", lookupOf([{ address, family: 4 }])),
      ).rejects.toHaveProperty("code", "SSRF_BLOCKED");
    });
  }

  test("blocks when ANY resolved address is private (multi-A-record)", async () => {
    await expect(
      assertUrl(
        "http://mixed.example/x",
        lookupOf([
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ]),
      ),
    ).rejects.toHaveProperty("code", "SSRF_BLOCKED");
  });

  test("public addresses pass", async () => {
    await expect(
      assertUrl(
        "http://example.com/x",
        lookupOf([{ address: "93.184.216.34", family: 4 }]),
      ),
    ).resolves.toBeUndefined();
  });

  test("url media is rejected BEFORE any fetch happens", async () => {
    const fetchCalls: string[] = [];
    await expect(
      resolveMedia(
        { url: "http://169.254.169.254/latest/meta-data" },
        {
          mediaDir: "/tmp",
          fetchFn: (async (input: string) => {
            fetchCalls.push(input);
            return new Response("secret", { status: 200 });
          }) as typeof fetch,
        },
      ),
    ).rejects.toHaveProperty("code", "SSRF_BLOCKED");
    expect(fetchCalls).toEqual([]);
  });

  test("redirects are re-validated (no blind following)", async () => {
    const fetchCalls: string[] = [];
    // first hop public, redirect target is the metadata service — the client
    // is created with redirect:"manual" so the GUARD must re-check the target
    const responses = [
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } }),
    ];
    await expect(
      resolveMedia({ url: "http://public.example/file" }, {
        mediaDir: "/tmp",
        fetchFn: (async (input: string) => {
          fetchCalls.push(input);
          return responses.shift() ?? new Response("ok");
        }) as typeof fetch,
      }),
    ).rejects.toHaveProperty("code", "SSRF_BLOCKED");
  });
});

async function assertUrl(
  url: string,
  lookup?: (host: string, opts?: unknown) => Promise<Array<{ address: string; family: number }>>,
): Promise<void> {
  const { assertPublicHttpUrl } = await import("../../src/media/resolve.ts");
  await assertPublicHttpUrl(url, lookup as never);
}
