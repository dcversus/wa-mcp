import type { WASocket } from "@whiskeysockets/baileys";

export class PairingCodeError extends Error {
  readonly code = "VALIDATION_ERROR";
}

export function formatPairingCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (clean.length !== 8) {
    return code;
  }
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

export async function requestPairingCode(socket: WASocket, phone: string): Promise<string> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new PairingCodeError(`phone must be 8-15 digits after stripping (got: ${phone})`);
  }
  const code = await socket.requestPairingCode(digits);
  return formatPairingCode(code);
}
