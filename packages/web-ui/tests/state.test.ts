import { describe, expect, test } from "vite-plus/test";
import {
  defaultBridgeUrl,
  effectiveToken,
  loadPairingToken,
  loadSettings,
  savePairingToken,
  saveSettings,
  type SettingsStorage,
} from "../src/state.ts";

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
  expect(loadSettings(memoryStorage())).toEqual({ bridgeUrl: "http://127.0.0.1:27777", token: "" });
});

test("saveSettings persists and loadSettings restores", () => {
  const storage = memoryStorage();
  saveSettings(storage, { bridgeUrl: "http://bridge:9999", token: "tok" });
  expect(loadSettings(storage)).toEqual({ bridgeUrl: "http://bridge:9999", token: "tok" });
});

test("corrupt stored settings fall back to defaults", () => {
  const storage = memoryStorage();
  storage.setItem("wa-mcp-settings", "{oops");
  expect(loadSettings(storage)).toEqual({ bridgeUrl: "http://127.0.0.1:27777", token: "" });
});

describe("T54 token resolution", () => {
  test("pairing token persists under its own key", () => {
    const storage = memoryStorage();
    savePairingToken(storage, "pair-tok-1");
    expect(storage.data.get("wa-mcp-pairing-token")).toBe("pair-tok-1");
    expect(loadPairingToken(storage)).toBe("pair-tok-1");
  });

  test("effectiveToken: saved token wins, pairing token is the fallback", () => {
    expect(effectiveToken({ bridgeUrl: "b", token: "real" }, "pair")).toBe("real");
    expect(effectiveToken({ bridgeUrl: "b", token: "" }, "pair")).toBe("pair");
    expect(effectiveToken({ bridgeUrl: "b", token: "" }, "")).toBe("");
  });
});

test("defaultBridgeUrl falls back to loopback in bare-node contexts", () => {
  expect(defaultBridgeUrl()).toBe("http://127.0.0.1:27777");
});
