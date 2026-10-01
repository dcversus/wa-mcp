import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import QRCode from "qrcode";

export function renderQrAscii(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "L" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const border = "#".repeat((size + 2) * 2);
  const lines: string[] = [border];
  for (let row = 0; row < size; row += 1) {
    let line = "##";
    for (let col = 0; col < size; col += 1) {
      line += data[row * size + col] ? "##" : "  ";
    }
    line += "##";
    lines.push(line);
  }
  lines.push(border);
  return `${lines.join("\n")}\n`;
}

export async function saveQrPng(text: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await QRCode.toFile(path, text, { type: "png", errorCorrectionLevel: "L", width: 512 });
}
