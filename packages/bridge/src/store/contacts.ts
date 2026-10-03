import type { Store } from "./schema.ts";

export interface ContactInput {
  jid: string;
  name?: string | null;
  pushname?: string | null;
  businessName?: string | null;
  phone?: string | null;
}

export interface ContactRow {
  jid: string;
  name: string | null;
  pushname: string | null;
  businessName: string | null;
  phone: string | null;
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
  const base: ContactRow =
    existing === undefined
      ? { jid: input.jid, name: null, pushname: null, businessName: null, phone: null }
      : rowToContact(existing);
  const merged: ContactRow = {
    jid: input.jid,
    name: mergeValue(input.name, base.name),
    pushname: mergeValue(input.pushname, base.pushname),
    businessName: mergeValue(input.businessName, base.businessName),
    phone: mergeValue(input.phone, base.phone),
  };
  store.db
    .prepare(
      "INSERT INTO contacts (jid, name, pushname, business_name, phone) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name, pushname = excluded.pushname, business_name = excluded.business_name, phone = excluded.phone",
    )
    .run(merged.jid, merged.name, merged.pushname, merged.businessName, merged.phone);
}

export function getContact(store: Store, jid: string): ContactRow | null {
  const row = store.db.prepare("SELECT * FROM contacts WHERE jid = ?").get(jid) as
    | RawRow
    | undefined;
  return row === undefined ? null : rowToContact(row);
}

export function listContacts(
  store: Store,
  opts: { query?: string; limit?: number } = {},
): ContactRow[] {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const query = opts.query?.trim().toLowerCase();
  if (query === undefined || query.length === 0) {
    const rows = store.db
      .prepare("SELECT * FROM contacts ORDER BY COALESCE(name, pushname, jid) ASC LIMIT ?")
      .all(limit) as RawRow[];
    return rows.map(rowToContact);
  }
  const pattern = `%${query}%`;
  const rows = store.db
    .prepare(
      "SELECT * FROM contacts WHERE LOWER(COALESCE(name, '')) LIKE ? OR LOWER(COALESCE(pushname, '')) LIKE ? OR LOWER(jid) LIKE ? ORDER BY COALESCE(name, pushname, jid) ASC LIMIT ?",
    )
    .all(pattern, pattern, pattern, limit) as RawRow[];
  return rows.map(rowToContact);
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
  const row = store.db.prepare("SELECT jid FROM aliases WHERE alias = ?").get(alias) as
    | { jid: string }
    | undefined;
  return row === undefined ? null : { jid: row.jid };
}
