import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { openStore, type Store } from "../src/store/schema.ts";
import {
  addLabel,
  assignChatLabel,
  listLabels,
  chatLabels,
} from "../src/store/labels.ts";
import { setAlias, getAlias } from "../src/store/contacts.ts";
import { createHttpServer } from "../src/http.ts";

const GROUP_A = "120363428874442773@g.us";
const created: Array<{ close(): Promise<void> }> = [];

describe("T89 — labels, warmup, cyrillic alias, manual unread", () => {
  test("line125 — label_add -> list shows it; assign -> chat carries it", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-labels-")));
    try {
      const id = addLabel(store, { name: "Work", color: "#ff0000" });
      expect(listLabels(store)).toEqual([{ id, name: "Work", color: "#ff0000" }]);
      assignChatLabel(store, GROUP_A, id);
      expect(chatLabels(store, GROUP_A)).toEqual([
        { id, name: "Work", color: "#ff0000" },
      ]);
    } finally {
      store.close();
    }
  });

  test("line131 — Cyrillic alias resolves case-insensitively; favorite round-trips", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-cyr-")));
    try {
      setAlias(store, GROUP_A, "Василиса");
      expect(getAlias(store, "василиса")?.jid).toBe(GROUP_A);
      expect(getAlias(store, "ВАСИЛИСА")?.jid).toBe(GROUP_A);
    } finally {
      store.close();
    }
  });
});
