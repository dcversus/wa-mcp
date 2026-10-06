export type JidType = "user" | "group" | "lid" | "newsletter" | "broadcast" | "unknown";

const DEFAULT_USER_DOMAIN = "s.whatsapp.net";
const SEPARATORS = /[\s()+-]/g;
const DEVICE_SUFFIX = /:\d+$/;

export function normalizeJid(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const at = trimmed.indexOf("@");
  if (at >= 0) {
    const local = trimmed.slice(0, at).replace(DEVICE_SUFFIX, "").trim();
    const domain = trimmed
      .slice(at + 1)
      .trim()
      .toLowerCase();
    if (local.length === 0 || domain.length === 0) {
      return null;
    }
    return `${local}@${domain}`;
  }
  const digits = trimmed.replace(SEPARATORS, "");
  if (!/^\d+$/.test(digits)) {
    return null;
  }
  return `${digits}@${DEFAULT_USER_DOMAIN}`;
}

export function jidType(jid: string): JidType {
  const normalized = normalizeJid(jid);
  if (normalized === null) {
    return "unknown";
  }
  if (normalized.endsWith(`@${DEFAULT_USER_DOMAIN}`)) {
    return "user";
  }
  if (normalized.endsWith("@g.us")) {
    return "group";
  }
  if (normalized.endsWith("@lid")) {
    return "lid";
  }
  if (normalized.endsWith("@newsletter")) {
    return "newsletter";
  }
  if (normalized.endsWith("@broadcast")) {
    return "broadcast";
  }
  return "unknown";
}

export function isPhoneJid(jid: string): boolean {
  return jidType(jid) === "user";
}

export function isGroupJid(jid: string): boolean {
  return jidType(jid) === "group";
}

export function isLidJid(jid: string): boolean {
  return jidType(jid) === "lid";
}

export function isValidRecipientJid(jid: string): boolean {
  const normalized = normalizeJid(jid);
  if (normalized === null) {
    return false;
  }
  const at = normalized.indexOf("@");
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (domain === "broadcast") {
    return true;
  }
  return /^\d+$/.test(local);
}

const JID_SHAPE = /^[a-z0-9]{3,}(:\d+)?@(s\.whatsapp\.net|g\.us|lid)$/;
const BROADCAST_SHAPE = /^[a-z]+@broadcast$/;

export function isJid(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim().toLowerCase();
  return JID_SHAPE.test(trimmed) || BROADCAST_SHAPE.test(trimmed);
}
