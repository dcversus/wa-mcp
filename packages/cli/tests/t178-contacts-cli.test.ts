import { expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";
import { runContacts, type ContactsDeps } from "../src/contacts.ts";

const DANA = "358400000001@s.whatsapp.net";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function harness(
  respond: (call: Call) => Response = () => Response.json({ contacts: [], total: 0 }),
): { deps: ContactsDeps; printed: string[]; calls: Call[] } {
  const printed: string[] = [];
  const calls: Call[] = [];
  const deps: ContactsDeps = {
    fetchFn: (async (input: string | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url: String(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
      return respond(call);
    }) as unknown as typeof fetch,
    print: (line) => printed.push(line),
  };
  return { deps, printed, calls };
}

const BASE = { baseUrl: "http://h", token: "tok" };

test("T178 B4 list — q/saved/limit become query params; table shows name, phone, WhatsApp name, jid", async () => {
  const { deps, printed, calls } = harness(() =>
    Response.json({
      total: 2,
      contacts: [
        {
          jid: DANA,
          displayName: "Dana Scully",
          phone: "+358 40 000 0001",
          name: "Dana Scully",
          pushname: "dana.s",
          username: null,
        },
        {
          jid: "55600000009854@lid",
          displayName: "Lid Person",
          phone: null,
          name: "Lid Person",
          pushname: null,
          username: "lid_p",
        },
      ],
    }),
  );
  const exit = await runContacts(deps, {
    ...BASE,
    action: "list",
    q: "da na",
    saved: true,
    limit: 20,
  });
  expect(exit).toBe(0);
  expect(calls[0]?.url).toBe("http://h/api/contacts?q=da+na&saved=true&limit=20");
  expect(printed[0]).toMatch(/^NAME\s+PHONE\s+ON WHATSAPP\s+JID$/);
  expect(printed[1]).toContain("Dana Scully");
  expect(printed[1]).toContain("+358 40 000 0001");
  expect(printed[1]).toContain("~dana.s");
  expect(printed[1]).toContain(DANA);
  expect(printed[2]).toContain("@lid_p");
  expect(printed[2]).toContain("—");
  expect(printed.at(-1)).toBe("2 contacts");
});

test("T178 B4 list — a capped page says how many more exist; empty says so", async () => {
  const capped = harness(() =>
    Response.json({
      total: 300,
      contacts: [{ jid: DANA, displayName: "D", phone: null, name: "D", pushname: null }],
    }),
  );
  await runContacts(capped.deps, { ...BASE, action: "list" });
  expect(capped.calls[0]?.url).toBe("http://h/api/contacts");
  expect(capped.printed.at(-1)).toBe("1 of 300 contacts — narrow with --q or raise --limit");
  const empty = harness();
  await runContacts(empty.deps, { ...BASE, action: "list", q: "zz" });
  expect(empty.printed).toEqual(["no contacts match"]);
});

test("T178 B4 add — POSTs phone/name/username and confirms the WhatsApp sync", async () => {
  const { deps, printed, calls } = harness(() =>
    Response.json(
      { contact: { jid: DANA, displayName: "Dana Scully", phone: "+358 40 000 0001" } },
      { status: 201 },
    ),
  );
  const exit = await runContacts(deps, {
    ...BASE,
    action: "add",
    target: "+358 40 000 0001",
    name: "Dana Scully",
    username: "dana_s",
  });
  expect(exit).toBe(0);
  expect(calls).toEqual([
    {
      method: "POST",
      url: "http://h/api/contacts",
      body: { phone: "+358 40 000 0001", name: "Dana Scully", username: "dana_s" },
    },
  ]);
  expect(printed).toEqual([
    `saved Dana Scully (+358 40 000 0001) ${DANA} — synced to your WhatsApp account`,
  ]);
});

test("T178 B4 rename/remove — PATCH/DELETE the encoded phone-or-jid path", async () => {
  const { deps, printed, calls } = harness((call) =>
    call.method === "DELETE"
      ? Response.json({ ok: true, removed: DANA })
      : Response.json({ contact: { jid: DANA, displayName: "Agent Scully", phone: null } }),
  );
  expect(
    await runContacts(deps, { ...BASE, action: "rename", target: DANA, name: "Agent Scully" }),
  ).toBe(0);
  expect(await runContacts(deps, { ...BASE, action: "remove", target: "+358400000001" })).toBe(0);
  expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
    ["PATCH", "http://h/api/contacts/358400000001%40s.whatsapp.net", { name: "Agent Scully" }],
    ["DELETE", "http://h/api/contacts/%2B358400000001", undefined],
  ]);
  expect(printed).toEqual([`renamed ${DANA} → Agent Scully`, `removed ${DANA} from your contacts`]);
});

test("T178 B4 usage errors never reach the bridge; HTTP errors surface the bridge message", async () => {
  const offline = harness();
  for (const [args, message] of [
    [
      { action: "add", target: "+358400000001" },
      "contacts add <phone> --name <name> [--username <u>]",
    ],
    [{ action: "add", name: "Dana" }, "contacts add <phone> --name <name> [--username <u>]"],
    [{ action: "rename", target: DANA }, "contacts rename <phone|jid> --name <name>"],
    [{ action: "remove" }, "contacts remove <phone|jid>"],
    [
      { action: "frobnicate" },
      "contacts: unknown action 'frobnicate' — use list, add, rename, remove or sync",
    ],
  ] as const) {
    offline.printed.length = 0;
    expect(await runContacts(offline.deps, { ...BASE, ...args })).toBe(1);
    expect(offline.printed).toEqual([message]);
  }
  expect(offline.calls).toHaveLength(0);
  const rejected = harness(() =>
    Response.json(
      { error: { code: "NOT_ON_WHATSAPP", message: "+358400000009 is not on WhatsApp" } },
      { status: 422 },
    ),
  );
  expect(
    await runContacts(rejected.deps, {
      ...BASE,
      action: "add",
      target: "+358400000009",
      name: "G",
    }),
  ).toBe(1);
  expect(rejected.printed).toEqual([
    "contacts failed: HTTP 422 — +358400000009 is not on WhatsApp",
  ]);
});

test("T178 B4 bin — `contacts` is routed and documented in usage", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async () =>
      Response.json({ contacts: [], total: 0 })) as unknown as typeof fetch);
  const previousExit = process.exitCode;
  try {
    await main(["contacts", "--q", "dana", "--token", "tok", "--bridge-url", "http://h"]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://h/api/contacts?q=dana");
    expect(logSpy.mock.calls.flat()).toContain("no contacts match");
    logSpy.mockClear();
    await main([]);
    const usage = logSpy.mock.calls.flat().join("\n");
    expect(usage).toContain(
      "contacts [--q <text>] [--saved] [--limit <n>] | contacts add <phone> --name <name> [--username <u>] | contacts rename <phone|jid> --name <name> | contacts remove <phone|jid>",
    );
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});

test("R2-2B sync — POSTs /api/contacts/sync (dry_run=1 with --dry-run) and prints the backfill counts", async () => {
  const counts = {
    fromChats: 1,
    fromSenders: 3,
    mergedLids: 1,
    removedNonPersons: 0,
    removedEmpty: 1,
    unresolvedLids: 1,
    total: 3,
  };
  const dry = harness(() => Response.json({ dryRun: true, ...counts }));
  expect(await runContacts(dry.deps, { ...BASE, action: "sync", dryRun: true })).toBe(0);
  expect(dry.calls[0]).toMatchObject({
    method: "POST",
    url: "http://h/api/contacts/sync?dry_run=1",
  });
  expect(dry.printed).toEqual([
    "contacts sync (dry run — nothing written): 1 from chats, 3 from message senders, 1 LID duplicates merged, 0 groups/channels removed, 1 empty rows removed, 1 unresolved LIDs — 3 contacts",
  ]);
  const real = harness(() => Response.json({ dryRun: false, ...counts }));
  expect(await runContacts(real.deps, { ...BASE, action: "sync" })).toBe(0);
  expect(real.calls[0]?.url).toBe("http://h/api/contacts/sync");
  expect(real.printed[0]).toMatch(/^contacts sync: 1 from chats/);
  const failed = harness(() =>
    Response.json({ error: { message: "store not attached" } }, { status: 501 }),
  );
  expect(await runContacts(failed.deps, { ...BASE, action: "sync" })).toBe(1);
  expect(failed.printed).toEqual(["contacts failed: HTTP 501 — store not attached"]);
});

test("R2-2B bin — `contacts sync --dry-run` is routed and documented", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async () => Response.json({ dryRun: true })) as unknown as typeof fetch);
  const previousExit = process.exitCode;
  try {
    await main(["contacts", "sync", "--dry-run", "--token", "tok", "--bridge-url", "http://h"]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://h/api/contacts/sync?dry_run=1");
    logSpy.mockClear();
    await main([]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("contacts sync [--dry-run]");
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});
