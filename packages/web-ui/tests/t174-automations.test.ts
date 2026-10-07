import { expect, test } from "vite-plus/test";
import { automationsPageHtml } from "../src/pages.ts";
import { statusDashboardHtml } from "../src/pages.ts";

const FIXTURE = {
  autoreplies: [
    {
      id: 1,
      match: "invoice",
      reply: "on it — sending now",
      enabled: true,
      createdAt: "2026-10-06T10:00:00Z",
    },
    {
      id: 2,
      match: "out of office",
      reply: "brb",
      enabled: false,
      createdAt: "2026-10-05T10:00:00Z",
    },
  ],
  scheduled: [
    {
      id: 7,
      chat_jid: "358400000001@s.whatsapp.net",
      payload: "happy birthday!",
      send_at: "2026-10-07T09:00:00Z",
      status: "pending",
      sent_message_id: null,
    },
  ],
  sendRules: [{ id: 3, target: "*@g.us", mode: "block", expiresAt: null }],
  rules: [
    {
      id: "r1",
      chat_jid: "120363428874442773@g.us",
      title: "invoice",
      body: "new one",
      deliver: ["mcp"],
    },
  ],
  resolveName: (jid: string) => (jid === "120363428874442773@g.us" ? "Test group" : null),
};

test("T174 B2 — the page renders all four sections", () => {
  const html = automationsPageHtml(FIXTURE);
  expect(html).toContain('id="automations-page"');
  expect(html).toContain("Autoreplies");
  expect(html).toContain("Scheduled messages");
  expect(html).toContain("Send rules");
  expect(html).toContain("Notification rules");
  expect(html).toContain("Replies sent automatically by your agent");
});

test("T174 B2 — autoreplies show pattern, reply and a pause/resume control", () => {
  const html = automationsPageHtml(FIXTURE);
  expect(html).toContain("invoice");
  expect(html).toContain("on it — sending now");
  expect(html).toContain('data-toggle-autoreply="1"');
  expect(html).toContain('data-toggle-autoreply="2"');
  expect(html).toContain("Paused");
  expect(html).toContain('data-delete-autoreply="1"');
});

test("T174 B2 — scheduled messages show recipient, text and status", () => {
  const html = automationsPageHtml(FIXTURE);
  expect(html).toContain("happy birthday!");
  expect(html).toContain("pending");
  expect(html).toContain('data-delete-scheduled="7"');
});

test("T174 B2 — send rules show target and mode with delete", () => {
  const html = automationsPageHtml(FIXTURE);
  expect(html).toContain("*@g.us");
  expect(html).toContain("block");
  expect(html).toContain('data-delete-sendrule="3"');
});

test("T174 B2 — notification rules render with a create form and delete", () => {
  const html = automationsPageHtml(FIXTURE);
  expect(html).toContain("Test group");
  expect(html).toContain('data-delete-rule="r1"');
  expect(html).toContain('id="rule-create"');
  expect(html).toContain('name="title"');
  expect(html).toContain('name="deliver"');
});

test("T174 B2 — every list has an empty state", () => {
  const empty = automationsPageHtml({ autoreplies: [], scheduled: [], sendRules: [], rules: [] });
  expect(empty).toContain("No autoreplies");
  expect(empty).toContain("Nothing scheduled");
  expect(empty).toContain("No send rules");
  expect(empty).toContain("No notification rules");
});

test("T174 B2 — the status page points at #/automations", () => {
  const html = statusDashboardHtml({ health: {}, notifications: [], events: [] });
  expect(html).toContain("#/automations");
  expect(html).toContain("Automations");
});
