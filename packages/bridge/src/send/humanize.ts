import type { AnyMessageContent, WASocket } from "baileys";
import type { HumanisationSettings } from "@wa-mcp/shared";

export const TYPING_REFRESH_MS = 10_000;
const JITTER = 0.2;
const SKIPPED_KEYS = ["react", "edit", "delete", "forward", "pin", "disappearingMessagesInChat"];

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface Humanizer {
  active(): boolean;
  beforeSend(socket: WASocket, jid: string, content: AnyMessageContent | object): Promise<void>;
  close(): void;
}

export class HumanizeAborted extends Error {
  constructor() {
    super("send cancelled — the bridge is shutting down");
  }
}

export function humanDelayMs(
  settings: HumanisationSettings,
  textLength: number,
  random: () => number = Math.random,
): number {
  const typed = settings.minDelayMs + textLength * settings.delayPerCharMs;
  const base = Math.min(Math.max(typed, settings.minDelayMs), settings.maxDelayMs);
  return Math.max(0, Math.round(base * (1 + (random() * 2 - 1) * JITTER)));
}

const defaultSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new HumanizeAborted());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new HumanizeAborted());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

function textOf(content: Record<string, unknown>): string {
  for (const key of ["text", "caption"]) {
    const value = content[key];
    if (typeof value === "string") {
      return value;
    }
  }
  const list = content.listMessage as { description?: unknown } | undefined;
  return typeof list?.description === "string" ? list.description : "";
}

function presenceFor(content: Record<string, unknown>): "composing" | "recording" {
  return content.audio !== undefined && content.ptt === true ? "recording" : "composing";
}

export function createHumanizer(deps: {
  settings: () => HumanisationSettings;
  sleep?: Sleep;
  random?: () => number;
  logger?: { warn(obj: unknown, msg?: string): void };
}): Humanizer {
  const sleep = deps.sleep ?? defaultSleep;
  const controller = new AbortController();
  const presence = async (
    socket: WASocket,
    type: "composing" | "recording" | "paused",
    jid: string,
  ): Promise<void> => {
    try {
      await socket.sendPresenceUpdate(type, jid);
    } catch (err: unknown) {
      deps.logger?.warn({ err, jid, type }, "typing status update failed");
    }
  };
  return {
    active: () => deps.settings().enabled,
    async beforeSend(socket, jid, content) {
      const settings = deps.settings();
      const fields = content as Record<string, unknown>;
      if (
        !settings.enabled ||
        jid === "status@broadcast" ||
        SKIPPED_KEYS.some((key) => fields[key] !== undefined)
      ) {
        return;
      }
      if (controller.signal.aborted) {
        throw new HumanizeAborted();
      }
      const typing = settings.typingStatus ? presenceFor(fields) : null;
      let remaining = humanDelayMs(settings, textOf(fields).length, deps.random);
      try {
        while (true) {
          if (typing !== null) {
            await presence(socket, typing, jid);
          }
          const chunk = Math.min(remaining, TYPING_REFRESH_MS);
          await sleep(chunk, controller.signal);
          remaining -= chunk;
          if (remaining <= 0) {
            break;
          }
        }
      } finally {
        if (typing !== null) {
          await presence(socket, "paused", jid);
        }
      }
    },
    close: () => {
      controller.abort();
    },
  };
}
