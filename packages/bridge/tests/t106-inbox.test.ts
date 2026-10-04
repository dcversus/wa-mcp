import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openInbox, readInboxLines } from "../src/inbox.ts";

function mkInbox(capBytes?: number): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "t106-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function event(over: Partial<{ text: string; kind: string; media: boolean }> = {}) {
  return {
    ts: "2026-10-05T02:30:00.000Z",
    kind: over.kind ?? "message",
    chat: "120363428874442773@g.us",
    from: "351930017568@s.whatsapp.net",
    text: over.text ?? "hello inbox",
    media: over.media ?? false,
  };
}

test("appendInbox writes one JSONL line with text capped at 280", () => {
  const { dir, cleanup } = mkInbox();
  try {
    const inbox = openInbox(dir);
    inbox.append(event({ text: "x".repeat(500) }));
    inbox.append(event({ media: true }));
    const lines = readInboxLines(dir);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toHaveLength(280);
    expect(lines[0]?.chat).toBe("120363428874442773@g.us");
    expect(lines[1]?.media).toBe(true);
  } finally {
    cleanup();
  }
});

test("rotates at cap: old lines move to inbox.1.jsonl, no torn lines, at most 2 files", () => {
  const { dir, cleanup } = mkInbox(1024);
  try {
    const inbox = openInbox(dir, 1024);
    for (let i = 0; i < 50; i += 1) {
      inbox.append(event({ text: `line ${i}` }));
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
    expect(files.length).toBeLessThanOrEqual(2);
    const allLines: string[] = [];
    for (const f of files) {
      const content = readFileSync(join(dir, f), "utf8");
      for (const line of content.split("\n").filter((l) => l.length > 0)) {
        expect(() => JSON.parse(line)).not.toThrow();
        allLines.push(line);
      }
    }
    expect(allLines.length).toBeGreaterThan(0);
    expect(allLines.length).toBeLessThanOrEqual(50);
    const newest = readInboxLines(dir);
    expect(newest.length).toBeGreaterThan(0);
    expect(newest.length).toBeLessThan(50);
    const lastNewest = newest[newest.length - 1]?.text;
    expect(lastNewest).toBe("line 49");
  } finally {
    cleanup();
  }
});

test("1000 interleaved appends across two inboxes produce zero torn lines", () => {
  const dirA = mkdtempSync(join(tmpdir(), "t106-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "t106-b-"));
  try {
    const a = openInbox(dirA);
    const b = openInbox(dirB);
    for (let i = 0; i < 1000; i += 1) {
      a.append(event({ text: `a${i}` }));
      b.append(event({ text: `b${i}` }));
    }
    for (const dir of [dirA, dirB]) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
        const content = readFileSync(join(dir, f), "utf8");
        for (const line of content.split("\n").filter((l) => l.length > 0)) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      }
    }
    expect(readInboxLines(dirA).length + readdirSync(dirA).length).toBeGreaterThan(0);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("write failure increments dropped instead of throwing", () => {
  const { dir, cleanup } = mkInbox();
  try {
    const inbox = openInbox(dir);
    inbox.append(event());
    const target = inbox.path();
    chmodSync(target, 0o400);
    expect(() => inbox.append(event())).not.toThrow();
    expect(inbox.dropped()).toBe(1);
    expect(existsSync(target)).toBe(true);
  } finally {
    chmodSync(dir, 0o700);
    chmodSync(join(dir, "inbox.jsonl"), 0o600);
    cleanup();
  }
});
