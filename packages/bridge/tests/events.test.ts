import { expect, test, vi } from "vite-plus/test";
import { EVENT_NAMES, createEventBus, type WaEvent } from "../src/events.ts";

test("event map covers the thirteen bridge events", () => {
  expect([...EVENT_NAMES].sort()).toEqual(
    [
      "call",
      "chats.update",
      "chats.upsert",
      "connection.update",
      "contacts.upsert",
      "creds.update",
      "group-participants.update",
      "groups.update",
      "groups.upsert",
      "message-receipt.update",
      "messages.upsert",
      "messaging-history.set",
      "presence.update",
    ].sort(),
  );
});

test("emit fans out to all subscribers in subscription order", () => {
  const bus = createEventBus();
  const seen: string[] = [];
  bus.subscribe(() => seen.push("a"));
  bus.subscribe(() => seen.push("b"));
  bus.emit({ type: "creds.update", payload: {} });
  expect(seen).toEqual(["a", "b"]);
});

test("unsubscribe by handle stops delivery", () => {
  const bus = createEventBus();
  const handler = vi.fn();
  const stop = bus.subscribe(handler);
  stop();
  bus.emit({ type: "presence.update", payload: { id: "x", presences: {} } });
  expect(handler).not.toHaveBeenCalled();
});

test("unsubscribe by handler identity stops delivery", () => {
  const bus = createEventBus();
  const handler = vi.fn();
  bus.subscribe(handler);
  bus.unsubscribe(handler);
  bus.emit({ type: "presence.update", payload: { id: "y", presences: {} } });
  expect(handler).not.toHaveBeenCalled();
});

test("late subscriber receives a replay of the last connection.update only", () => {
  const bus = createEventBus();
  bus.emit({ type: "connection.update", payload: { connection: "open" } });
  bus.emit({ type: "messages.upsert", payload: { messages: [], type: "notify" } });
  const handler = vi.fn();
  bus.subscribe(handler);
  const types = handler.mock.calls.map((call) => (call[0] as WaEvent).type);
  expect(types).toEqual(["connection.update"]);
});

test("events emitted after subscribing are delivered after the replay", () => {
  const bus = createEventBus();
  bus.emit({ type: "connection.update", payload: { connection: "connecting" } });
  const seen: WaEvent[] = [];
  bus.subscribe((event) => seen.push(event));
  bus.emit({ type: "connection.update", payload: { connection: "open" } });
  const types = seen.map((event) => event.type);
  expect(types).toEqual(["connection.update", "connection.update"]);
  expect(seen[1]?.payload).toEqual({ connection: "open" });
});

test("discriminated union narrows by event type", () => {
  const bus = createEventBus();
  const upsertTypes: string[] = [];
  bus.subscribe((event) => {
    if (event.type === "messages.upsert") {
      upsertTypes.push(event.payload.type);
    }
  });
  bus.emit({ type: "messages.upsert", payload: { messages: [], type: "append" } });
  expect(upsertTypes).toEqual(["append"]);
});

test("T62/I: the event map covers groups.upsert (13 events)", () => {
  expect(EVENT_NAMES).toContain("groups.upsert");
  expect(EVENT_NAMES).toHaveLength(13);
});
