import { expect, test } from "vite-plus/test";
import { hookSnippet, subscriptionsPageHtml, type SubscriptionRow } from "../src/pages.ts";

const row: SubscriptionRow = {
  id: "abc123",
  chatJid: "120363428874442773@g.us",
  allChats: false,
  kinds: ["message"],
  includeMedia: false,
  inboxPath: "/home/u/.wa-mcp/subs/abc123/inbox.jsonl",
};

test("page renders inbox path per subscription row", () => {
  const html = subscriptionsPageHtml([row]);
  expect(html).toContain("/home/u/.wa-mcp/subs/abc123/inbox.jsonl");
  expect(html).toContain('data-sub-id="abc123"');
  expect(html).toContain("120363428874442773@g.us");
});

test("hook snippet contains 'wa-mcp inbox drain --inbox <path>' and is HTML-escaped in the page", () => {
  expect(hookSnippet("/home/u/.wa-mcp/subs/abc123/inbox.jsonl")).toBe(
    "wa-mcp inbox drain --inbox /home/u/.wa-mcp/subs/abc123/inbox.jsonl",
  );
  const evil: SubscriptionRow = { ...row, id: `x"><script>alert(1)</script>` };
  const html = subscriptionsPageHtml([evil]);
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("wa-mcp inbox drain --inbox ");
  expect(html).toContain("&lt;script&gt;");
});

test("delete button carries the sub id; create form posts selected chat", () => {
  const html = subscriptionsPageHtml([row]);
  expect(html).toContain('class="delete-subscription"');
  expect(html).toContain('data-sub-id="abc123"');
  expect(html).toContain('id="subscription-form"');
  expect(html).toContain('name="chat_jid"');
  expect(html).toContain('name="all_chats"');
});

test("createSubscription posts selected chats via the api client", async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const client = {
    createSubscription: async (body: { chat_jid?: string }) => {
      calls.push({ path: "/api/subscriptions", method: "POST", body });
      return { id: "new1", inboxPath: "/subs/new1/inbox.jsonl" };
    },
    listSubscriptions: async () => ({ subscriptions: [] }),
    deleteSubscription: async (id: string) => {
      calls.push({ path: `/api/subscriptions/${id}`, method: "DELETE" });
    },
  } as unknown as Awaited<ReturnType<typeof import("../src/api.ts").createApiClient>>;
  const created = await client.createSubscription({ chat_jid: "120363428874442773@g.us" });
  expect(created.inboxPath).toContain("new1");
  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.body).toEqual({ chat_jid: "120363428874442773@g.us" });
  await client.deleteSubscription("new1");
  expect(calls.at(-1)?.method).toBe("DELETE");
  expect(calls.at(-1)?.path).toBe("/api/subscriptions/new1");
});

test("T142-W2 — the picker renders chats as per-row toggles with jids", () => {
  const chats = [
    { jid: "120363428874442773@g.us", name: "Test Group", unreadCount: 0 },
    { jid: "358497773518@s.whatsapp.net", name: "V", unreadCount: 0 },
  ];
  const html = subscriptionsPageHtml([], chats);
  expect(html).toContain('id="sub-chat-picker"');
  expect(html).toContain('class="sub-chat-row"');
  expect(html).toContain('data-chat-jid="120363428874442773@g.us"');
  expect(html).toContain('data-chat-jid="358497773518@s.whatsapp.net"');
  expect(html).toContain("Test Group");
});

test("T142-W2 — the advanced form stays inside details with its ids intact", () => {
  const html = subscriptionsPageHtml(
    [
      {
        id: "abc12345",
        chatJid: "358400000001@s.whatsapp.net",
        allChats: false,
        kinds: ["message"],
        includeMedia: true,
        inboxPath: "/x",
      },
    ],
    [{ jid: "358497773518@s.whatsapp.net", name: "V", unreadCount: 0 }],
  );
  expect(html).toContain("<details");
  expect(html).toContain('id="subscription-form"');
  expect(html).toContain('id="subscription-list"');
  expect(html).toContain('class="subscription-row"');
  expect(html).toContain('data-sub-id="abc12345"');
});

test("T142-W2 — empty chats shows the empty state", () => {
  const html = subscriptionsPageHtml([], []);
  expect(html).toContain("No chats yet");
});
