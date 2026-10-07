import { escapeHtml } from "./escape.ts";
import { formatWhen } from "./pages.ts";

export interface FeedLine {
  at: number;
  type: string;
  detail: string;
}

/** Newest 50 lines, oldest first; never mutates the input. */
export function appendEvent(feed: FeedLine[], line: FeedLine, cap = 50): FeedLine[] {
  const next = [...feed, line];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

interface UnknownPayload {
  [key: string]: unknown;
}

function stringAt(payload: UnknownPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/** Map a raw bridge event (JSON over SSE) to a readable feed line. */
export function eventLine(raw: { type?: unknown; payload?: unknown }): FeedLine {
  const type = typeof raw.type === "string" ? raw.type : "unknown";
  const payload = (raw.payload ?? {}) as UnknownPayload;
  let detail = "";
  if (type === "connection.update") {
    detail = stringAt(payload, "connection") ?? (payload.qr !== undefined ? "qr" : "");
  } else if (type === "messages.upsert") {
    const messages = Array.isArray(payload.messages) ? (payload.messages as UnknownPayload[]) : [];
    const first = messages[0];
    const pushName = first ? stringAt(first, "pushName") : undefined;
    detail = pushName ?? `${messages.length} message(s)`;
  } else if (type === "creds.update") {
    detail = "credentials updated";
  } else if (type === "presence.update") {
    detail = "presence changed";
  } else {
    detail = "";
  }
  return { at: Date.now(), type, detail };
}

export interface StatusStreamOptions {
  url: string;
  token: string;
  EventSourceImpl?: typeof EventSource;
  onLine(line: FeedLine): void;
  onRaw?(raw: { type?: unknown; payload?: unknown }): void;
}

export interface StatusStream {
  close(): void;
}

/** EventSource cannot send Authorization headers — the bridge accepts
 * ?token= on /events specifically (T52 bridge contract). */
export function openStatusStream(options: StatusStreamOptions): StatusStream {
  const Impl = options.EventSourceImpl ?? EventSource;
  const source = new Impl(`${options.url}/events?token=${encodeURIComponent(options.token)}`);
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      const raw = JSON.parse(event.data) as { type?: unknown; payload?: unknown };
      options.onLine(eventLine(raw));
      options.onRaw?.(raw);
    } catch {
      // malformed frame — drop it, keep the stream alive
    }
  };
  return { close: () => source.close() };
}

/** Render helper: escaped feed lines for the status dashboard. */
export function feedHtml(feed: FeedLine[]): string {
  return feed
    .map(
      (line) =>
        `<li><time>${escapeHtml(formatWhen(line.at))}</time> <strong>${escapeHtml(line.type)}</strong> <span>${escapeHtml(line.detail)}</span></li>`,
    )
    .join("");
}
