import { expect, test } from "vite-plus/test";
import { transcriptionSettingsHtml } from "../src/pages.ts";

test("transcription settings section renders engine select + fields", () => {
  const html = transcriptionSettingsHtml({
    engine: "mock",
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1",
    apiKeyMasked: "sk-…3456",
  });
  expect(html).toContain('id="transcription-engine"');
  expect(html).toContain('value="mock"');
  expect(html).toContain('id="transcription-base-url"');
  expect(html).toContain('id="transcription-model"');
  expect(html).toContain('id="transcription-api-key"');
  expect(html).toContain("sk-…3456");
  expect(html).not.toContain("sk-test-full-secret-value");
});

test("engine select offers the supported engines", () => {
  const html = transcriptionSettingsHtml({});
  for (const engine of ["mock", "openai", "mlx", "whisper-local"]) {
    expect(html).toContain(`value="${engine}"`);
  }
});

test("a set api key placeholder does not leak the raw key", () => {
  const html = transcriptionSettingsHtml({ apiKeyMasked: "sk-…AAAA" });
  expect(html).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
});

test("settingsHtml escapes bridge url and token attribute values", async () => {
  const { settingsHtml } = await import("../src/pages.ts");
  const html = settingsHtml({
    bridgeUrl: 'http://x"><script>alert(1)</script>',
    token: 't"><img src=x>',
  });
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img ");
});
