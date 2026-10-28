import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { storeMessage } from "../src/store/messages.ts";
import { openStore } from "../src/store/schema.ts";

const row = (store: ReturnType<typeof openStore>, id: string) =>
  store.db
    .prepare("SELECT sender_jid, key_remote_jid, key_participant FROM messages WHERE id = ?")
    .get(id);

test("the store keeps the key as WhatsApp addressed it next to the canonical sender", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-t203-")));
  try {
    storeMessage(
      store,
      {
        key: {
          remoteJid: "120363428874442773@g.us",
          id: "W1",
          fromMe: false,
          participant: "351900000001@s.whatsapp.net",
        },
        message: { conversation: "hi" },
        messageTimestamp: 1,
      } as never,
      { remoteJid: "120363428874442773@g.us", participant: "70000000000001@lid" },
    );
    // a caller that didn't rewrite the key: the key itself is the wire key
    storeMessage(store, {
      key: { remoteJid: "77777@lid", id: "W2", fromMe: false },
      message: { conversation: "dm" },
      messageTimestamp: 1,
    } as never);
    expect(row(store, "W1")).toEqual({
      sender_jid: "351900000001@s.whatsapp.net",
      key_remote_jid: "120363428874442773@g.us",
      key_participant: "70000000000001@lid",
    });
    expect(row(store, "W2")).toEqual({
      sender_jid: "77777@lid",
      key_remote_jid: "77777@lid",
      key_participant: null,
    });
  } finally {
    store.close();
  }
});
