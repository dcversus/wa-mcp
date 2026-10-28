import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import QRCode from "qrcode";
import { renderQrTerminal } from "@wa-mcp/shared";

/** T80 line60: cp1252-hostile consoles — every stderr byte must be ASCII
 * or Windows consoles throw EILSEQ (or mojibake). Replace, don't drop. */
export function asciiSafe(text: string): string {
  return text.replace(/[^\x20-\x7E\n]/g, "?");
}

/** the QR for an interactive terminal: explicit black-on-white with a
 * 4-module quiet zone; ASCII-only background cells on legacy Windows
 * consoles that can't draw block glyphs (Windows Terminal sets WT_SESSION) */
export function renderQrForTerminal(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "L" });
  const ascii = process.platform === "win32" && process.env.WT_SESSION === undefined;
  return renderQrTerminal({ size: qr.modules.size, data: qr.modules.data }, { ascii });
}

export async function saveQrPng(text: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await QRCode.toFile(path, text, { type: "png", errorCorrectionLevel: "L", width: 512 });
}
