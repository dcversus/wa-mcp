import { expect, test } from "vite-plus/test";
import { createToolsChangedWatcher } from "../src/mcp-notify.ts";

test("a change in the visible tool-name set emits exactly one notifications/tools/list_changed; an unchanged set emits none", () => {
  let visible = ["send_message", "list_chats"];
  const watch = createToolsChangedWatcher(() => visible);
  expect(watch()).toHaveLength(0);
  visible = ["send_message", "list_chats", "get_privacy"];
  const emitted = watch();
  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.method).toBe("notifications/tools/list_changed");
  expect(emitted[0]?.jsonrpc).toBe("2.0");
  expect(watch()).toHaveLength(0);
  visible = ["get_privacy", "list_chats", "send_message"];
  expect(watch()).toHaveLength(0);
  visible = ["send_message", "list_chats"];
  expect(watch()).toHaveLength(1);
});

test("watcher is order-insensitive via sorted hash", () => {
  let visible = ["b_tool", "a_tool"];
  const watch = createToolsChangedWatcher(() => visible);
  expect(watch()).toHaveLength(0);
  visible = ["a_tool", "b_tool"];
  expect(watch()).toHaveLength(0);
});
