import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { drainInbox } from "../src/subscribe.ts";

function eventLine(fields: Record<string, unknown>): string {
  return `${JSON.stringify({
    ts: "2026-10-06T20:00:00.000Z",
    kind: "message",
    chat: "120363428874442773@g.us",
    from: "358400000002@s.whatsapp.net",
    text: "hello from the group",
    media: false,
    ...fields,
  })}\n`;
}

test("T156 W5 — exit 2 carries one stderr line per event with id and names", () => {
  const dir = mkdtempSync(join(tmpdir(), "t156-"));
  try {
    const inbox = join(dir, "inbox.jsonl");
    const state = join(dir, "cursor");
    writeFileSync(
      inbox,
      eventLine({ id: "M1", chatName: "Test group", fromName: "Dana" }) +
        eventLine({ id: "M2", chatName: "Test group", fromName: "Lena", text: "second" }),
    );
    const result = drainInbox(inbox, state);
    expect(result.exit).toBe(2);
    expect(result.stream).toBe("stderr");
    expect(result.lines).toHaveLength(2);
    expect(result.lines?.[0]).toContain("Test group");
    expect(result.lines?.[0]).toContain("Dana");
    expect(result.lines?.[0]).toContain("M1");
    expect(result.lines?.[1]).toContain("M2");
    expect(result.hint).toBe("use list_messages chat_jid=120363428874442773@g.us to read more");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T156 W5 — event lines are capped at 20", () => {
  const dir = mkdtempSync(join(tmpdir(), "t156-"));
  try {
    const inbox = join(dir, "inbox.jsonl");
    const state = join(dir, "cursor");
    let content = "";
    for (let index = 0; index < 25; index += 1) {
      content += eventLine({ id: `M${index}`, text: `msg ${index}` });
    }
    writeFileSync(inbox, content);
    const result = drainInbox(inbox, state);
    expect(result.exit).toBe(2);
    expect(result.lines).toHaveLength(20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T156 W5 — zero new events stays a stdout no-op", () => {
  const dir = mkdtempSync(join(tmpdir(), "t156-"));
  try {
    const inbox = join(dir, "inbox.jsonl");
    const state = join(dir, "cursor");
    writeFileSync(inbox, eventLine({ id: "M1" }));
    drainInbox(inbox, state);
    const result = drainInbox(inbox, state);
    expect(result.exit).toBe(0);
    expect(result.stream).toBe("stdout");
    expect(result.lines).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
