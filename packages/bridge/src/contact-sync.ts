import { jidType, normalizeJid, phoneDigits } from "@wa-mcp/shared";
import type { Store } from "./store/schema.ts";
import { clearSavedName, getContactView, upsertContact } from "./store/contacts.ts";

/** The companion-device contact actions WhatsApp Web uses (fork
 * Socket/chats.js): an app-state `contactAction` patch on index
 * ['contact', jid] — SET to save/rename, REMOVE to delete. */
export interface ContactEngine {
  addOrEditContact?: (
    jid: string,
    contact: {
      fullName: string;
      firstName: string;
      username?: string;
      saveOnPrimaryAddressbook: boolean;
    },
  ) => Promise<unknown>;
  removeContact?: (jid: string) => Promise<unknown>;
  onWhatsApp?: (...jids: string[]) => Promise<Array<{ jid: string; exists: unknown }> | undefined>;
}

export interface ContactSyncResult {
  status: number;
  body: unknown;
}

function failure(status: number, code: string, message: string): ContactSyncResult {
  return { status, body: { error: { code, message } } };
}

function invalid(message: string): ContactSyncResult {
  return failure(400, "VALIDATION_ERROR", message);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback;
}

function personJid(raw: string): string | null {
  const jid = normalizeJid(raw);
  if (jid === null) {
    return null;
  }
  const type = jidType(jid);
  if (type === "user") {
    return phoneDigits(jid) === null ? null : jid;
  }
  return type === "lid" ? jid : null;
}

const PERSON_JID_MESSAGE = "jid must be a person (…@s.whatsapp.net or …@lid)";

interface NameInput {
  name: string;
  username?: string;
}

function parseNameInput(raw: Record<string, unknown>): NameInput | ContactSyncResult {
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return invalid("name is required");
  }
  if (raw.username !== undefined && typeof raw.username !== "string") {
    return invalid("username must be a string");
  }
  const username = typeof raw.username === "string" ? raw.username.trim() : "";
  return {
    name: raw.name.trim(),
    ...(username.length > 0 ? { username } : {}),
  };
}

function parseBody(body: Buffer): Record<string, unknown> | ContactSyncResult {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return invalid("body must be a JSON object");
    }
    return value as Record<string, unknown>;
  } catch {
    return invalid("body must be valid JSON");
  }
}

function isResult(value: unknown): value is ContactSyncResult {
  return typeof value === "object" && value !== null && "status" in value && "body" in value;
}

async function resolvePhone(
  engine: ContactEngine,
  digits: string,
): Promise<string | ContactSyncResult> {
  const candidate = `${digits}@s.whatsapp.net`;
  if (typeof engine.onWhatsApp !== "function") {
    return candidate;
  }
  let found: Array<{ jid: string; exists: unknown }> | undefined;
  try {
    found = await engine.onWhatsApp(candidate);
  } catch (err) {
    return failure(502, "CONTACT_LOOKUP_FAILED", errorMessage(err, "onWhatsApp failed"));
  }
  const hit = (found ?? []).find((entry) => entry.exists === true);
  if (hit === undefined) {
    return failure(422, "NOT_ON_WHATSAPP", `+${digits} is not on WhatsApp`);
  }
  return personJid(hit.jid) ?? candidate;
}

/** POST /api/contacts, PATCH|DELETE /api/contacts/:jid — the path segment
 * accepts a jid or a bare phone number. */
export async function serveContactWrite(
  method: string,
  segment: string | undefined,
  body: Buffer,
  store: Store,
  engine: ContactEngine | null | undefined,
): Promise<ContactSyncResult> {
  if (segment === undefined && method !== "POST") {
    return failure(405, "METHOD_NOT_ALLOWED", "use GET or POST");
  }
  if (segment !== undefined && method !== "PATCH" && method !== "DELETE") {
    return failure(405, "METHOD_NOT_ALLOWED", "use GET, PATCH or DELETE");
  }
  const pathJid = segment === undefined ? null : personJid(segment);
  if (segment !== undefined && pathJid === null) {
    return invalid(PERSON_JID_MESSAGE);
  }
  const raw = method === "DELETE" ? {} : parseBody(body);
  if (isResult(raw)) {
    return raw;
  }
  const input = method === "DELETE" ? null : parseNameInput(raw);
  if (isResult(input)) {
    return input;
  }
  let phone: string | null = null;
  if (method === "POST") {
    if (raw.jid === undefined && raw.phone === undefined) {
      return invalid("phone or jid is required");
    }
    if (raw.jid !== undefined && (typeof raw.jid !== "string" || personJid(raw.jid) === null)) {
      return invalid(PERSON_JID_MESSAGE);
    }
    if (raw.jid === undefined) {
      phone = typeof raw.phone === "string" ? phoneDigits(raw.phone) : null;
      if (phone === null || (typeof raw.phone === "string" && raw.phone.includes("@"))) {
        return invalid("phone must be 8-15 digits with country code");
      }
    }
  }
  if (engine === null || engine === undefined) {
    return failure(503, "NOT_CONNECTED", "WhatsApp is not connected — contacts sync live");
  }
  if (method === "DELETE") {
    const jid = pathJid as string;
    if (typeof engine.removeContact !== "function") {
      return failure(501, "NOT_IMPLEMENTED", "engine lacks removeContact");
    }
    try {
      await engine.removeContact(jid);
    } catch (err) {
      return failure(502, "CONTACT_SYNC_FAILED", errorMessage(err, "removeContact failed"));
    }
    clearSavedName(store, jid);
    return { status: 200, body: { ok: true, removed: jid } };
  }
  const nameInput = input as NameInput;
  if (typeof engine.addOrEditContact !== "function") {
    return failure(501, "NOT_IMPLEMENTED", "engine lacks addOrEditContact");
  }
  let jid: string;
  if (pathJid !== null) {
    jid = pathJid;
  } else if (phone === null) {
    jid = personJid(raw.jid as string) as string;
  } else {
    const resolved = await resolvePhone(engine, phone);
    if (isResult(resolved)) {
      return resolved;
    }
    jid = resolved;
  }
  try {
    await engine.addOrEditContact(jid, {
      fullName: nameInput.name,
      firstName: nameInput.name.split(/\s+/)[0] ?? nameInput.name,
      ...(nameInput.username !== undefined ? { username: nameInput.username } : {}),
      saveOnPrimaryAddressbook: true,
    });
  } catch (err) {
    return failure(502, "CONTACT_SYNC_FAILED", errorMessage(err, "addOrEditContact failed"));
  }
  upsertContact(store, {
    jid,
    name: nameInput.name,
    username: nameInput.username,
    phone: phone ?? phoneDigits(jid),
  });
  return { status: method === "POST" ? 201 : 200, body: { contact: getContactView(store, jid) } };
}
