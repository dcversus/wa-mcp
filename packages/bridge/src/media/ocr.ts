import { spawn } from "node:child_process";
import { MediaError } from "./resolve.ts";

export interface OcrOptions {
  engine?: string;
  language?: string;
  spawnFn?: typeof spawn;
}

export async function ocrImage(path: string, opts: OcrOptions = {}): Promise<string> {
  const engine = opts.engine ?? process.env.WA_OCR_ENGINE ?? "none";
  if (engine === "none" || engine.length === 0) {
    throw new MediaError(
      "ENGINE_NOT_CONFIGURED",
      "OCR is disabled — set WA_OCR_ENGINE=tesseract to enable (requires the tesseract binary: brew install tesseract)",
    );
  }
  if (engine !== "tesseract") {
    throw new MediaError(
      "ENGINE_NOT_CONFIGURED",
      `unknown OCR engine: ${engine} — supported: tesseract (WA_OCR_ENGINE)`,
    );
  }
  const spawnFn = opts.spawnFn ?? spawn;
  const language = opts.language ?? process.env.WA_OCR_LANG ?? "eng";
  return new Promise<string>((resolve, reject) => {
    const child = spawnFn("tesseract", [path, "-", "-l", language]);
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", () => undefined);
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(
        new MediaError(
          "ENGINE_UNAVAILABLE",
          `tesseract not runnable (${err.message}) — install with: brew install tesseract`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new MediaError("ENGINE_UNAVAILABLE", `tesseract exited ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}
