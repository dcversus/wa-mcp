import { expect, test } from "vite-plus/test";
import {
  appendEvent,
  eventLine,
  openStatusStream,
  type FeedLine,
} from "../src/events-feed.ts";

test("appendEvent keeps the newest 50 lines in order", () => {
  let feed: FeedLine[] = [];
  for (let index = 0; index < 55; index += 1) {
    feed = appendEvent(feed, { at: index, type: "connection.update", detail: String(index) });
  }
  expect(feed.length).toBe(50);
  expect(feed[0]?.detail).toBe("5");
  expect(feed[49]?.detail).toBe("54");
});

test("appendEvent does not mutate the input array", () => {
  const before: FeedLine[] = [{ at: 1, type: "message", detail: "a" }];
  const after = appendEvent(before, { at: 2, type: "message", detail: "b" });
  expect(before.length).toBe(1);
  expect(after.length).toBe(2);
});

test("eventLine maps connection updates to a readable detail", () => {
  expect(
    eventLine({ type: "connection.update", payload: { connection: "open" } }),
  ).toMatchObject({ type: "connection.update", detail: "open" });
  expect(
    eventLine({ type: "messages.upsert", payload: { messages: [{ key: { id: "m1" }, pushName: "V" }] } }),
  ).toMatchObject({ type: "messages.upsert", detail: "V" });
  expect(eventLine({ type: "creds.update", payload: {} })).toMatchObject({
    type: "creds.update",
    detail: "credentials updated",
  });
});

test("openStatusStream wires an EventSource to onLine and closes cleanly", () => {
  const lines: FeedLine[] = [];
  const sources: Array<{ url: string; close: () => void; onmessage: ((e: { data: string }) => void) | null }> = [];
  class FakeEventSource {
    public onmessage: ((e: { data: string }) => void) | null = null;
    public closed = false;
    constructor(public url: string) {
      sources.push(this);
    }
    close(): void {
      this.closed = true;
    }
  }
  const stream = openStatusStream({
    url: "http://bridge",
    token: "tok",
    EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    onLine: (line) => lines.push(line),
  });
  expect(sources[0]?.url).toBe("http://bridge/events?token=tok");
  sources[0]?.onmessage?.({ data: JSON.stringify({ type: "connection.update", payload: { connection: "open" } }) });
  expect(lines).toEqual([{ at: expect.any(Number), type: "connection.update", detail: "open" }]);
  stream.close();
  expect(sources[0]?.closed).toBe(true);
});

test("openStatusStream ignores malformed frames", () => {
  const lines: FeedLine[] = [];
  class FakeEventSource {
    public onmessage: ((e: { data: string }) => void) | null = null;
    constructor(public url: string) {}
    close(): void {}
  }
  const stream = openStatusStream({
    url: "http://bridge",
    token: "tok",
    EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    onLine: (line) => lines.push(line),
  });
  sources_push(stream);
  function sources_push(_s: unknown): void {}
  const source = (stream as unknown as { source: FakeEventSource }).source;
  source.onmessage?.({ data: "not-json" });
  source.onmessage?.({ data: JSON.stringify({ type: "creds.update", payload: {} }) });
  expect(lines.length).toBe(1);
});
