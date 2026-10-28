import { formatPhone, jidType, normalizeJid, phoneDigits } from "@wa-mcp/shared";
import type { Store } from "./schema.ts";

export interface ContactInput {
  jid: string;
  name?: string | null;
  pushname?: string | null;
  businessName?: string | null;
  phone?: string | null;
  username?: string | null;
  lid?: string | null;
}

export interface ContactRow {
  jid: string;
  name: string | null;
  pushname: string | null;
  businessName: string | null;
  phone: string | null;
  username: string | null;
  lid: string | null;
}

export interface ContactView {
  jid: string;
  displayName: string;
  phone: string | null;
  name: string | null;
  pushname: string | null;
  username: string | null;
  lid: string | null;
  businessName: string | null;
  alias: string | null;
  source: "whatsapp" | "alias";
}

type RawRow = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function rowToContact(row: RawRow): ContactRow {
  return {
    jid: asString(row.jid) ?? "",
    name: asString(row.name),
    pushname: asString(row.pushname),
    businessName: asString(row.business_name),
    phone: asString(row.phone),
    username: asString(row.username),
    lid: asString(row.lid),
  };
}

function mergeValue(newValue: string | null | undefined, existing: string | null): string | null {
  if (newValue === undefined || newValue === null || newValue.length === 0) {
    return existing;
  }
  return newValue;
}

export function upsertContact(store: Store, input: ContactInput): void {
  const existing = store.db.prepare("SELECT * FROM contacts WHERE jid = ?").get(input.jid) as
    | RawRow
    | undefined;
  const base = existing === undefined ? rowToContact({ jid: input.jid }) : rowToContact(existing);
  const merged: ContactRow = {
    jid: input.jid,
    name: mergeValue(input.name, base.name),
    pushname: mergeValue(input.pushname, base.pushname),
    businessName: mergeValue(input.businessName, base.businessName),
    phone: mergeValue(input.phone, base.phone),
    username: mergeValue(input.username, base.username),
    lid: mergeValue(input.lid, base.lid),
  };
  store.db
    .prepare(
      "INSERT INTO contacts (jid, name, pushname, business_name, phone, username, lid) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name, pushname = excluded.pushname, business_name = excluded.business_name, phone = excluded.phone, username = excluded.username, lid = excluded.lid",
    )
    .run(
      merged.jid,
      merged.name,
      merged.pushname,
      merged.businessName,
      merged.phone,
      merged.username,
      merged.lid,
    );
}

/** Like upsertContact, but stored values win: input only fills NULL fields
 * (backfills must never clobber a roster name with a chat title). */
export function fillContactBlanks(store: Store, input: ContactInput): void {
  const existing = getContact(store, input.jid);
  if (existing === null) {
    upsertContact(store, input);
    return;
  }
  upsertContact(store, {
    jid: input.jid,
    name: existing.name ?? input.name,
    pushname: existing.pushname ?? input.pushname,
    businessName: existing.businessName ?? input.businessName,
    phone: existing.phone ?? input.phone,
    username: existing.username ?? input.username,
    lid: existing.lid ?? input.lid,
  });
}

/** Maps a LID jid to its phone-number jid, or null when the mapping is unknown. */
export type PnResolver = (lidJid: string) => string | null;

function isPersonJid(jid: string): boolean {
  const type = jidType(jid);
  return type === "user" || type === "lid";
}

/** Folds a stored <lid>@lid row into its PN row (PN values win), then drops it. */
export function absorbLidRow(store: Store, lidJid: string, pnJid: string): boolean {
  const lidRow = getContact(store, lidJid);
  if (lidRow === null || lidJid === pnJid) {
    return false;
  }
  fillContactBlanks(store, { ...lidRow, jid: pnJid, lid: lidJid });
  deleteContact(store, lidJid);
  return true;
}

/** The engine-event write path: LID ids resolve to their PN jid (explicit
 * phone first, then the lid mapping) so one person is one row keyed by PN
 * with the lid column set; groups/channels are not contacts; a row with
 * nothing to show is never stored. Returns whether a row was written. */
export function upsertResolvedContact(
  store: Store,
  input: ContactInput,
  resolvePn: PnResolver,
): boolean {
  const jid = normalizeJid(input.jid);
  if (jid === null || !isPersonJid(jid)) {
    return false;
  }
  const lid = jidType(jid) === "lid" ? jid : (input.lid ?? null);
  const explicitPhone = phoneDigits(input.phone ?? "");
  const pnJid =
    jidType(jid) === "user"
      ? jid
      : explicitPhone !== null
        ? `${explicitPhone}@s.whatsapp.net`
        : resolvePn(jid);
  const target = pnJid ?? jid;
  const phone = explicitPhone ?? phoneDigits(target);
  const fields = [input.name, input.pushname, input.businessName, input.username, phone];
  if (!fields.some((value) => typeof value === "string" && value.trim().length > 0)) {
    return false;
  }
  upsertContact(store, { ...input, jid: target, phone, lid });
  if (lid !== null && target !== lid) {
    absorbLidRow(store, lid, target);
  }
  return true;
}

export function clearSavedName(store: Store, jid: string): void {
  store.db.prepare("UPDATE contacts SET name = NULL, username = NULL WHERE jid = ?").run(jid);
}

export function getContact(store: Store, jid: string): ContactRow | null {
  const row = store.db.prepare("SELECT * FROM contacts WHERE jid = ?").get(jid) as
    | RawRow
    | undefined;
  return row === undefined ? null : rowToContact(row);
}

function present(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

function toView(row: ContactRow, alias: string | null): ContactView {
  const phone = formatPhone(row.phone ?? "") ?? formatPhone(row.jid);
  const fallback = [row.pushname, row.username, row.businessName, phone].find(present);
  const displayName = present(row.name) ? row.name : alias !== null ? alias : (fallback ?? row.jid);
  return {
    jid: row.jid,
    displayName,
    phone,
    name: row.name,
    pushname: row.pushname,
    username: row.username,
    lid: row.lid,
    businessName: row.businessName,
    alias,
    source: !present(row.name) && alias !== null ? "alias" : "whatsapp",
  };
}

function matches(view: ContactView, text: string, digits: string | null): boolean {
  const fields = [view.displayName, view.name, view.pushname, view.username, view.alias];
  if (fields.some((field) => field !== null && field.toLowerCase().includes(text))) {
    return true;
  }
  if (view.businessName?.toLowerCase().includes(text) || view.jid.includes(text)) {
    return true;
  }
  if (digits === null) {
    return false;
  }
  const phone = view.phone === null ? "" : (phoneDigits(view.phone) ?? "");
  return phone.includes(digits);
}

/** The person-only contact list (groups, newsletters and broadcasts are chats,
 * not contacts). Filtering + sorting run in JS: SQLite's LOWER() folds ASCII
 * only, and a WhatsApp roster is thousands of rows at most. */
export function listContactViews(
  store: Store,
  opts: { query?: string; limit?: number; saved?: boolean } = {},
): { contacts: ContactView[]; total: number } {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 1000);
  const aliases = new Map<string, string>();
  const aliasRows = store.db
    .prepare("SELECT alias, jid FROM aliases ORDER BY created_at ASC")
    .all() as Array<{ alias: string; jid: string }>;
  for (const row of aliasRows) {
    if (!aliases.has(row.jid)) {
      aliases.set(row.jid, row.alias);
    }
  }
  const text = opts.query?.trim().toLowerCase() ?? "";
  const stripped = text.replace(/[\s()+-]/g, "");
  const digits = /^\d+$/.test(stripped) ? stripped : null;
  const views = (store.db.prepare("SELECT * FROM contacts").all() as RawRow[])
    .map(rowToContact)
    .filter((row) => {
      const type = jidType(row.jid);
      return type === "user" || type === "lid";
    })
    .filter((row) => opts.saved !== true || present(row.name))
    .map((row) => toView(row, aliases.get(row.jid) ?? null))
    // a bare unresolved LID has nothing a person could recognise — hide it
    .filter((view) =>
      [view.name, view.pushname, view.username, view.businessName, view.phone, view.alias].some(
        present,
      ),
    )
    .filter((view) => text.length === 0 || matches(view, text, digits))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  return { contacts: views.slice(0, limit), total: views.length };
}

export function getContactView(store: Store, jid: string): ContactView | null {
  const row = getContact(store, jid);
  if (row === null) {
    return null;
  }
  const alias = store.db
    .prepare("SELECT alias FROM aliases WHERE jid = ? ORDER BY created_at ASC LIMIT 1")
    .get(jid) as { alias: string } | undefined;
  return toView(row, alias?.alias ?? null);
}

export function deleteContact(store: Store, jid: string): void {
  store.db.prepare("DELETE FROM contacts WHERE jid = ?").run(jid);
}

export function setAlias(store: Store, jid: string, alias: string): void {
  store.db
    .prepare(
      "INSERT INTO aliases (alias, jid, is_favorite, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(alias) DO UPDATE SET jid = excluded.jid",
    )
    .run(alias, jid, new Date().toISOString());
}

export function getAlias(store: Store, alias: string): { jid: string } | null {
  // T89 line131: case-insensitive INCLUDING non-ASCII (Cyrillic) — SQLite's
  // LOWER() folds ASCII only, so compare with JS toLowerCase over the set.
  const needle = alias.toLowerCase();
  const rows = store.db.prepare("SELECT alias, jid FROM aliases").all() as Array<{
    alias: string;
    jid: string;
  }>;
  const hit = rows.find((row) => row.alias.toLowerCase() === needle);
  return hit === undefined ? null : { jid: hit.jid };
}

/** Whether a one-to-one chat is with someone saved in the contact list. The
 * chat may arrive as a PN or a LID jid and the contact row may be keyed by
 * either, so the jid, the recorded LID and the phone digits all count. */
export function isSavedContactDm(store: Store, chatJids: string[]): boolean {
  const people = [...new Set(chatJids)].filter((jid) => {
    const type = jidType(jid);
    return type === "user" || type === "lid";
  });
  if (people.length === 0) {
    return false;
  }
  const bare = people.map((jid) => jid.replace(/:\d+@/, "@"));
  const phones = bare
    .filter((jid) => jidType(jid) === "user")
    .map((jid) => phoneDigits(jid))
    .filter((digits): digits is string => digits !== null);
  const marks = (count: number) => Array.from({ length: count }, () => "?").join(", ");
  const row = store.db
    .prepare(
      `SELECT 1 AS hit FROM contacts WHERE name IS NOT NULL AND TRIM(name) != '' AND (jid IN (${marks(bare.length)}) OR lid IN (${marks(bare.length)})${phones.length > 0 ? ` OR REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', '') IN (${marks(phones.length)})` : ""}) LIMIT 1`,
    )
    .get(...bare, ...bare, ...phones);
  return row !== undefined;
}
