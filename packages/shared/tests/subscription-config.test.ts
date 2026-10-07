import { expect, test } from "vite-plus/test";
import {
  DELIVERY_MODES,
  validateSubscriptionConfigInput,
  type SubscriptionConfigInput,
} from "../src/subscription-config.ts";

const GROUP = "120363428874442773@g.us";
const DM = "358401112222@s.whatsapp.net";

function errorOf(input: unknown): string {
  const result = validateSubscriptionConfigInput(input);
  if (result.ok) throw new Error("expected a validation error");
  return result.message;
}

test("T177 B1 — delivery modes are inbox | session | spawn", () => {
  expect(DELIVERY_MODES).toEqual(["inbox", "session", "spawn"]);
});

test("T177 B1 — a minimal inbox config normalises defaults", () => {
  const result = validateSubscriptionConfigInput({
    name: "  Family  ",
    chats: [GROUP],
    delivery: { mode: "inbox" },
  });
  expect(result).toEqual({
    ok: true,
    value: {
      name: "Family",
      chats: [GROUP],
      filter: {},
      delivery: { mode: "inbox" },
      enabled: true,
    },
  });
});

test("T177 B1 — a full spawn config round-trips every field", () => {
  const input: SubscriptionConfigInput = {
    name: "Mentions",
    chats: [GROUP, DM],
    filter: { like: "%invoice%", mentionOnly: true },
    prompt: "Triage this message",
    delivery: {
      mode: "spawn",
      agent: { command: "claude", args: ["-p"], env: { ANTHROPIC_MODEL: "opus" } },
    },
    enabled: false,
  };
  expect(validateSubscriptionConfigInput(input)).toEqual({ ok: true, value: input });
});

test("T177 B1 — session mode accepts a named session or any active session", () => {
  expect(
    validateSubscriptionConfigInput({
      name: "s",
      chats: [DM],
      delivery: { mode: "session", session: "abc-123" },
    }).ok,
  ).toBe(true);
  expect(
    validateSubscriptionConfigInput({ name: "s", chats: [DM], delivery: { mode: "session" } }).ok,
  ).toBe(true);
});

test("T177 B1 — validation errors name the bad field", () => {
  expect(errorOf(null)).toBe("body must be a JSON object");
  expect(errorOf({ chats: [DM], delivery: { mode: "inbox" } })).toBe("name is required");
  expect(errorOf({ name: "x", chats: [], delivery: { mode: "inbox" } })).toBe(
    "chats must list at least one chat",
  );
  expect(errorOf({ name: "x", delivery: { mode: "inbox" } })).toBe(
    "chats must list at least one chat",
  );
  expect(errorOf({ name: "x", chats: [DM, "not-a-jid"], delivery: { mode: "inbox" } })).toBe(
    "chats[1] is not a WhatsApp chat id: not-a-jid",
  );
  expect(errorOf({ name: "x", chats: [DM] })).toBe(
    "delivery.mode must be one of inbox, session, spawn",
  );
  expect(errorOf({ name: "x", chats: [DM], delivery: { mode: "email" } })).toBe(
    "delivery.mode must be one of inbox, session, spawn",
  );
  expect(errorOf({ name: "x", chats: [DM], delivery: { mode: "spawn" } })).toBe(
    "delivery.agent.command is required for spawn",
  );
  expect(
    errorOf({
      name: "x",
      chats: [DM],
      delivery: { mode: "spawn", agent: { command: "c", args: [1] } },
    }),
  ).toBe("delivery.agent.args must be a list of strings");
  expect(
    errorOf({
      name: "x",
      chats: [DM],
      delivery: { mode: "spawn", agent: { command: "c", env: { A: 1 } } },
    }),
  ).toBe("delivery.agent.env must map names to strings");
  expect(errorOf({ name: "x", chats: [DM], delivery: { mode: "session", session: 5 } })).toBe(
    "delivery.session must be a string",
  );
  expect(errorOf({ name: "x", chats: [DM], filter: "%a%", delivery: { mode: "inbox" } })).toBe(
    "filter must be an object",
  );
  expect(
    errorOf({ name: "x", chats: [DM], filter: { like: 3 }, delivery: { mode: "inbox" } }),
  ).toBe("filter.like must be a string");
  expect(
    errorOf({
      name: "x",
      chats: [DM],
      filter: { mentionOnly: "yes" },
      delivery: { mode: "inbox" },
    }),
  ).toBe("filter.mentionOnly must be a boolean");
  expect(errorOf({ name: "x", chats: [DM], prompt: 1, delivery: { mode: "inbox" } })).toBe(
    "prompt must be a string",
  );
  expect(errorOf({ name: "x", chats: [DM], enabled: "no", delivery: { mode: "inbox" } })).toBe(
    "enabled must be a boolean",
  );
});

test("T177 B1 — mode-irrelevant delivery fields are dropped", () => {
  const result = validateSubscriptionConfigInput({
    name: "x",
    chats: [DM],
    delivery: { mode: "inbox", session: "s", agent: { command: "c" } },
  });
  expect(result.ok && result.value.delivery).toEqual({ mode: "inbox" });
});
