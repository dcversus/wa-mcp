import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../../src/store/schema.ts";
import { applyReaction } from "../../src/store/messages.ts";

test("T94-D-M1 — changing a reaction leaves exactly one row per sender", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-react-m1-")));
  try {
    store.db
      .prepare(
        "INSERT INTO messages (id, chat_jid, sender_jid, timestamp, content, is_from_me) VALUES ('MSG1', '358497773518@s.whatsapp.net', '358400000077@s.whatsapp.net', '2026-01-01T00:00:00Z', 'pick one', 0)",
      )
      .run();
    applyReaction(
      store,
      "358497773518@s.whatsapp.net",
      "MSG1",
      "👍",
      "358400000077@s.whatsapp.net",
    );
    // the sender changes their mind — 👍 must NOT survive next to ❤️
    applyReaction(
      store,
      "358497773518@s.whatsapp.net",
      "MSG1",
      "❤️",
      "358400000077@s.whatsapp.net",
    );
    // RED today: OR REPLACE keyed (chat, message, emoji, sender) keeps both
    const rows = store.db
      .prepare("SELECT emoji FROM reactions WHERE message_id = 'MSG1'")
      .all() as Array<{ emoji: string }>;
    expect(rows).toEqual([{ emoji: "❤️" }]);
  } finally {
    store.close();
  }
});
