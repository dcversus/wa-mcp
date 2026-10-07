import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface InboxEvent {
  ts: string;
  kind: string;
  chat: string;
  from: string;
  text: string;
  media: boolean;
  id?: string;
  chatName?: string | null;
  fromName?: string | null;
  fromMe?: boolean;
}

export interface InboxWriter {
  append(event: InboxEvent): void;
  dropped(): number;
  path(): string;
}

const TEXT_CAP = 280;
const DEFAULT_CAP_BYTES = 2 * 1024 * 1024;

export function openInbox(dir: string, capBytes: number = DEFAULT_CAP_BYTES): InboxWriter {
  let dropped = 0;
  const inboxPath = join(dir, "inbox.jsonl");
  const rotatedPath = join(dir, "inbox.1.jsonl");
  return {
    append(event) {
      const line = `${JSON.stringify({ ...event, text: event.text.slice(0, TEXT_CAP) })}\n`;
      try {
        if (existsSync(inboxPath) && statSync(inboxPath).size + line.length > capBytes) {
          rmSync(rotatedPath, { force: true });
          renameSync(inboxPath, rotatedPath);
        }
        appendFileSync(inboxPath, line);
      } catch {
        dropped += 1;
      }
    },
    dropped() {
      return dropped;
    },
    path() {
      return inboxPath;
    },
  };
}

export function readInboxLines(dir: string): InboxEvent[] {
  const inboxPath = join(dir, "inbox.jsonl");
  if (!existsSync(inboxPath)) {
    return [];
  }
  return readFileSync(inboxPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as InboxEvent);
}
