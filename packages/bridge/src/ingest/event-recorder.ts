import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const FORBIDDEN_KEYS = new Set([
  "creds",
  "authState",
  "noiseKey",
  "noiseKeyPrivate",
  "signedIdentityKey",
  "signedPreKey",
  "signedPreKeyPrivate",
  "registrationId",
]);

function scrub(value: unknown, depth: number): unknown {
  if (depth > 6 || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrub(entry, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    out[key] = scrub(entry, depth + 1);
  }
  return out;
}

export interface EventRecorder {
  record(eventName: string, payload: unknown): void;
  active: boolean;
}

export function createEventRecorder(dir: string | undefined): EventRecorder {
  if (dir === undefined || dir.length === 0) {
    return { record: () => {}, active: false };
  }
  mkdirSync(dirname(join(dir, "probe")), { recursive: true });
  return {
    active: true,
    record(eventName, payload) {
      const safe = eventName.replace(/[^a-zA-Z0-9._-]/g, "_");
      appendFileSync(join(dir, `${safe}.jsonl`), `${JSON.stringify(scrub(payload, 0))}\n`);
    },
  };
}
