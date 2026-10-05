import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const doc = readFileSync(
  join(import.meta.dirname, "../../../docs/cookbook/media-understanding.md"),
  "utf8",
);
const transcribeSrc = readFileSync(
  join(import.meta.dirname, "../../bridge/src/media/transcribe.ts"),
  "utf8",
);
const ocrSrc = readFileSync(join(import.meta.dirname, "../../bridge/src/media/ocr.ts"), "utf8");
const doctorSrc = readFileSync(join(import.meta.dirname, "../src/doctor.ts"), "utf8");
const cliBin = readFileSync(join(import.meta.dirname, "../src/bin.ts"), "utf8");

test("the doc lists exactly the engines the code supports", () => {
  const engines = ["mock", "openai", "mlx", "whisper-local"];
  for (const engine of engines) {
    expect(transcribeSrc).toContain(`"${engine}"`);
    expect(doc).toContain(`\`${engine}\``);
  }
});

test("doc claims match OCR defaults", () => {
  expect(ocrSrc).toContain('process.env.WA_OCR_ENGINE ?? "none"');
  expect(doc).toContain("default");
  expect(doc).toContain("WA_OCR_ENGINE=tesseract");
});

test("doctor --engines exists in code and doc", () => {
  expect(cliBin).toContain("engines: flags.engines");
  expect(doctorSrc).toContain("engines");
  expect(doc).toContain("doctor --engines");
});

test("config commands in doc match the CLI surface", () => {
  expect(cliBin).toContain('command === "config"');
  for (const cmd of [
    "config set transcription.api_key",
    "config get transcription.api_key",
    "config list",
  ]) {
    expect(doc).toContain(cmd);
  }
});

test("doc documents transcript surfacing in list_messages", () => {
  const toolsSrc = readFileSync(join(import.meta.dirname, "../../mcp-server/src/tools.ts"), "utf8");
  expect(toolsSrc).toContain("transcript {text, engine, kind, language, truncated}");
  expect(doc).toContain("transcript { text, engine, kind, language, truncated }");
});
