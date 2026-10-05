/** Kinds the dispatch path actually emits to subscription inboxes.
 * Extending this list REQUIRES wiring the new kind into the bridge ingest
 * dispatch (http.ts message/rule emit sites) — a kind listed here but never
 * dispatched would silently never match. */
export const DISPATCHED_SUBSCRIPTION_KINDS = ["message"] as const;
