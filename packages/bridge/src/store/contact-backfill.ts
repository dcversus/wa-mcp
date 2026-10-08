import { jidType, normalizeJid, phoneDigits } from "@wa-mcp/shared";
import {
  absorbLidRow,
  fillContactBlanks,
  upsertResolvedContact,
  type PnResolver,
} from "./contacts.ts";
import { readReverseMapping } from "./merge-lid-chats.ts";
import type { Store } from "./schema.ts";

export interface BackfillResult {
  /** person chats whose title filled a contact */
  fromChats: number;
  /** distinct inbound senders whose pushname filled a contact */
  fromSenders: number;
  /** <lid>@lid rows folded into their PN row */
  mergedLids: number;
  /** group/newsletter/broadcast rows dropped (they are chats, not contacts) */
  removedNonPersons: number;
  /** rows left with nothing to show (no name, pushname, phone, …) */
  removedEmpty: number;
  /** @lid rows still without a known phone number */
  unresolvedLids: number;
  /** contacts rows after the backfill */
  total: number;
}

/** PN resolver backed by the engine's lid-mapping-<lid>_reverse.json files. */
export function lidResolver(authDir: string): PnResolver {
  return (lidJid) => {
    const normalized = normalizeJid(lidJid);
    if (normalized === null || jidType(normalized) !== "lid") {
      return null;
    }
    const pn = readReverseMapping(authDir, normalized.slice(0, -"@lid".length));
    return pn === null ? null : `${pn}@s.whatsapp.net`;
  };
}

function count(store: Store, sql: string): number {
  return (store.db.prepare(sql).get() as { n: number }).n;
}

/** sender_name falls back to the jid digits when no pushName arrived — a
 * number posing as a name is not identity data */
function usableName(name: string | null): name is string {
  return name !== null && name.trim().length > 0 && !/^\+?[\d\s]+$/.test(name.trim());
}

/** Rebuilds contact identity from what the store already holds: chat titles,
 * inbound sender pushnames and the engine's LID↔PN mapping. Fill-blank only
 * (never overwrites a roster value), idempotent, one transaction; dryRun
 * computes the same counts and rolls back. */
export function backfillContacts(
  store: Store,
  opts: { resolvePn: PnResolver; dryRun?: boolean },
): BackfillResult {
  const { resolvePn } = opts;
  const result: BackfillResult = {
    fromChats: 0,
    fromSenders: 0,
    mergedLids: 0,
    removedNonPersons: 0,
    removedEmpty: 0,
    unresolvedLids: 0,
    total: 0,
  };
  store.db.exec("BEGIN");
  try {
    const nonPersons = (
      store.db.prepare("SELECT jid FROM contacts").all() as Array<{ jid: string }>
    )
      .map((row) => row.jid)
      .filter((jid) => !["user", "lid"].includes(jidType(jid)));
    for (const jid of nonPersons) {
      store.db.prepare("DELETE FROM contacts WHERE jid = ?").run(jid);
    }
    result.removedNonPersons = nonPersons.length;

    const lidRows = store.db
      .prepare("SELECT jid FROM contacts WHERE jid LIKE '%@lid'")
      .all() as Array<{ jid: string }>;
    for (const { jid } of lidRows) {
      const pn = resolvePn(jid);
      if (pn === null) {
        continue;
      }
      // the PN row must exist for the fold; phone comes from its jid
      fillContactBlanks(store, { jid: pn, phone: phoneDigits(pn), lid: jid });
      if (absorbLidRow(store, jid, pn)) {
        result.mergedLids += 1;
      }
    }

    const chats = store.db
      .prepare("SELECT jid, name FROM chats WHERE name IS NOT NULL AND TRIM(name) <> ''")
      .all() as Array<{ jid: string; name: string }>;
    for (const chat of chats) {
      if (!["user", "lid"].includes(jidType(chat.jid))) {
        continue;
      }
      const pn = jidType(chat.jid) === "lid" ? resolvePn(chat.jid) : chat.jid;
      const jid = pn ?? chat.jid;
      fillContactBlanks(store, {
        jid,
        name: chat.name,
        phone: phoneDigits(jid),
        lid: pn !== null && pn !== chat.jid ? chat.jid : null,
      });
      result.fromChats += 1;
    }

    // newest sender_name per inbound sender (is_from_me rows carry the owner)
    const senders = store.db
      .prepare(
        `SELECT sender_jid AS jid, sender_name AS name FROM messages
         WHERE is_from_me = 0 AND sender_jid IS NOT NULL AND sender_name IS NOT NULL
         ORDER BY timestamp DESC`,
      )
      .all() as Array<{ jid: string; name: string | null }>;
    const seen = new Set<string>();
    for (const sender of senders) {
      const jid = normalizeJid(sender.jid);
      if (jid === null || seen.has(jid) || !usableName(sender.name)) {
        continue;
      }
      seen.add(jid);
      if (!["user", "lid"].includes(jidType(jid))) {
        continue;
      }
      const pn = jidType(jid) === "lid" ? resolvePn(jid) : jid;
      const target = pn ?? jid;
      fillContactBlanks(store, {
        jid: target,
        pushname: sender.name,
        phone: phoneDigits(target),
        lid: jidType(jid) === "lid" ? jid : null,
      });
      result.fromSenders += 1;
    }

    // a stale NULL row from an old roster push: re-resolve it the way the
    // live write path would, else drop it
    const empty = store.db
      .prepare(
        `SELECT jid FROM contacts WHERE COALESCE(TRIM(name), '') = '' AND COALESCE(TRIM(pushname), '') = ''
           AND COALESCE(TRIM(business_name), '') = '' AND COALESCE(TRIM(username), '') = ''
           AND COALESCE(TRIM(phone), '') = ''`,
      )
      .all() as Array<{ jid: string }>;
    for (const { jid } of empty) {
      if (phoneDigits(jid) !== null) {
        upsertResolvedContact(store, { jid }, resolvePn);
        continue;
      }
      store.db.prepare("DELETE FROM contacts WHERE jid = ?").run(jid);
      result.removedEmpty += 1;
    }

    result.unresolvedLids = count(
      store,
      "SELECT COUNT(*) AS n FROM contacts WHERE jid LIKE '%@lid'",
    );
    result.total = count(store, "SELECT COUNT(*) AS n FROM contacts");
    store.db.exec(opts.dryRun === true ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    store.db.exec("ROLLBACK");
    throw err;
  }
  return result;
}
