import { expect, test } from "vite-plus/test";
import { loadSettings, needsToken, saveSettings, type SettingsStorage } from "../src/state.ts";

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

test("loadSettings returns defaults on empty storage", () => {
  expect(loadSettings(memoryStorage())).toEqual({ bridgeUrl: "http://127.0.0.1:8080", token: "" });
});

test("saveSettings persists and loadSettings restores", () => {
  const storage = memoryStorage();
  saveSettings(storage, { bridgeUrl: "http://bridge:9999", token: "tok" });
  expect(loadSettings(storage)).toEqual({ bridgeUrl: "http://bridge:9999", token: "tok" });
});

test("corrupt stored settings fall back to defaults", () => {
  const storage = memoryStorage();
  storage.setItem("wa-mcp-settings", "{oops");
  expect(loadSettings(storage)).toEqual({ bridgeUrl: "http://127.0.0.1:8080", token: "" });
});

test("needsToken is true only without a token", () => {
  expect(needsToken({ bridgeUrl: "x", token: "" })).toBe(true);
  expect(needsToken({ bridgeUrl: "x", token: "t" })).toBe(false);
});
