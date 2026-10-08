export const PRIVACY_SETTINGS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "last", label: "Last seen" },
  { key: "online", label: "Online" },
  { key: "profile", label: "Profile photo" },
  { key: "status", label: "About" },
  { key: "groupadd", label: "Who can add me to groups" },
  { key: "calladd", label: "Who can call me" },
  { key: "messages", label: "Who can message me" },
  { key: "readreceipts", label: "Read receipts" },
];

export const PRIVACY_READ_TO_WRITE: Record<string, string> = {
  last: "lastSeen",
  profile: "profilePic",
  status: "status",
  groupadd: "groups",
  calladd: "calls",
  readreceipts: "readReceipts",
  online: "online",
  messages: "messages",
};

export const PRIVACY_VALUES: Record<string, string[]> = {
  last: ["all", "contacts", "contact_blacklist", "none"],
  profile: ["all", "contacts", "contact_blacklist", "none"],
  status: ["all", "contacts", "contact_blacklist", "none"],
  groupadd: ["all", "contacts", "contact_blacklist", "none"],
  calladd: ["all", "known"],
  readreceipts: ["all", "none"],
  online: ["all", "match_last_seen"],
  messages: ["all", "contacts"],
};

export const PRIVACY_LABELS: Record<string, string> = {
  all: "Everyone",
  contacts: "My contacts",
  contact_blacklist: "My contacts except…",
  none: "Nobody",
  match_last_seen: "Same as last seen",
  known: "People I know",
};

export function buildPrivacyPatch(readKey: string, value: string): Record<string, string> {
  const writeKey = PRIVACY_READ_TO_WRITE[readKey];
  if (writeKey === undefined) {
    throw new Error(`unknown privacy key: ${readKey}`);
  }
  return { [writeKey]: value };
}

export function privacyOptionsFor(readKey: string): string[] {
  return PRIVACY_VALUES[readKey] ?? ["all"];
}
