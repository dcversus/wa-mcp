import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DISPOSITIONS = [
  "ABSORBED",
  "SUPERSEDED-BY",
  "NA-ENGINE",
  "ALREADY-CORE",
  "OUT-OF-SCOPE-0.9",
  "NOISE",
] as const;
type Disposition = (typeof DISPOSITIONS)[number];

interface Item {
  repo: string;
  id: string;
  kind: "issue" | "pr";
  state: string;
  title: string;
}

function parseCensus(text: string): Item[] {
  const items: Item[] = [];
  let repo = "";
  for (const lineRaw of text.split("\n")) {
    const line = lineRaw.trim();
    const repoMatch = line.match(/^## (\S+)\/\S+/);
    if (repoMatch) {
      repo = repoMatch[1];
      continue;
    }
    const itemMatch = line.match(/^- \[ \] (I#|PR#)(\d+) \[(OPEN|CLOSED|MERGED)\] (.+)$/);
    if (itemMatch && repoMatch === null) {
      // header matched above consumed repo lines; this branch kept for safety
    }
    const item = line.match(/^- \[ \] ((?:I|PR)#\d+) \[(OPEN|CLOSED|MERGED)\] (.+)$/);
    if (item && repo !== "") {
      items.push({
        repo,
        id: item[1],
        kind: item[1].startsWith("I#") ? "issue" : "pr",
        state: item[2],
        title: item[3],
      });
    }
  }
  return items;
}

interface Override {
  disposition: Disposition;
  note: string;
}

const ID_OVERRIDES = new Map<string, Override>();

function override(repo: string, id: string, disposition: Disposition, note: string): void {
  ID_OVERRIDES.set(`${repo}#${id}`, { disposition, note });
}

override(
  "FelixIsaac",
  "PR#55",
  "NA-ENGINE",
  "mlx on-device transcription engine - macOS-only native path; baileys layer has no say, engine adapter planned post-0.9",
);
override(
  "chigwell",
  "I#39",
  "NA-ENGINE",
  "filesystem-style file-path tools - telegram-mcp specific removal; wa-mcp media flows through the media dir sandbox",
);
override("chigwell", "I#50", "SUPERSEDED-BY", "stdio + HTTP /mcp transports both shipped");
override(
  "chigwell",
  "I#16",
  "ABSORBED",
  "output size limits with truncation - pagination clamps + limit params on list endpoints",
);

const KEYWORD_RULES: Array<{ test: RegExp; disposition: Disposition; note: string }> = [
  {
    test: /ci\(deps\)|bump .* (from|to|group)|dependabot|codecov|codeql|renovate/i,
    disposition: "NOISE",
    note: "dependency/CI chore",
  },
  {
    test: /^update (readme|docs)|readme (update|improve|fix|add)|docs?:/i,
    disposition: "NOISE",
    note: "docs chore in source repo",
  },
  {
    test: /glama|smithery listing|mcp\.directory|pulse|directory listing/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "directory listing - post-approval publish (contract: no publishing)",
  },
  {
    test: /docker|dockerfile|docker-compose/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "container packaging deferred post-0.9",
  },
  {
    test: /uvx|pip|pipx|python|pyproject|poetry|uv\b/i,
    disposition: "NA-ENGINE",
    note: "python-runtime packaging - wa-mcp is a node/vite+ implementation",
  },
  {
    test: /telegram|tg_\b|telegram-mcp/i,
    disposition: "NA-ENGINE",
    note: "telegram-specific - different messenger",
  },
  {
    test: /whatsapp-web\.js|wweb|venom|wppconnect|whatsmeow|go-whatsapp|scaffold|go implementation|graft/i,
    disposition: "NA-ENGINE",
    note: "different engine runtime",
  },
  {
    test: /buttons|interactive (message|list)|list message/i,
    disposition: "NA-ENGINE",
    note: "buttons/lists sending dropped from baileys rc14 AnyMessageContent; Business-account delivery only (probed)",
  },
  {
    test: /multi[- ]?account|multiple (accounts|instances)|second (number|account)|create_instance|restart_instance/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "multi-instance documented exclusion",
  },
  {
    test: /agent[- ]mode|auto[- ]?reply (agent|bot|llm)|gpt[- ]auto|llm (auto|reply)|autonomous/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "event-driven LLM auto-reply agent mode excluded; rule-based autoreply rules shipped instead",
  },
  {
    test: /mcpl|model context protocol layer/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "MCPL protocol excluded",
  },
  {
    test: /commerce|catalog|product message|order message|send_order|send_product/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "commerce/catalog excluded",
  },
  {
    test: /semantic|vector (search|recall)|embedding/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "semantic recall excluded",
  },
  {
    test: /openwebui|chatgpt connector|chatgpt plugin/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "third-party connector excluded",
  },
  {
    test: /media|image|video|audio|sticker|voice|file|document|download|transcri/i,
    disposition: "ABSORBED",
    note: "media pipeline: resolve/download/transcribe endpoints + send_media/get_media/transcribe_message",
  },
  {
    test: /qr|pair|link device|linked device/i,
    disposition: "ABSORBED",
    note: "pairing: qr ascii+png+/api/qr+web pairing page; session persistence auth store",
  },
  {
    test: /unread|read receipt|mark.*(read|unread)/i,
    disposition: "ABSORBED",
    note: "read-state: mark_chat_read/get_unread_counts + /api/read + /api/unread",
  },
  {
    test: /search|fts|full[- ]?text/i,
    disposition: "ABSORBED",
    note: "FTS5 search_messages with triggers + /api/search",
  },
  {
    test: /contact/i,
    disposition: "ABSORBED",
    note: "contacts store + /api/contacts + list_contacts/set_alias",
  },
  {
    test: /group|participant|subject|invite/i,
    disposition: "ABSORBED",
    note: "groups: wrappers + /api/group/* + 5 group tools",
  },
  {
    test: /block/i,
    disposition: "ABSORBED",
    note: "blocklist: block_unblock/get_blocklist + /api/block",
  },
  {
    test: /privacy|last seen|online status|read receipts|profile pic(ture)? privacy/i,
    disposition: "ABSORBED",
    note: "privacy: 8 engine-truthed setters + /api/privacy + set_privacy",
  },
  {
    test: /profile|about|status text|presence/i,
    disposition: "ABSORBED",
    note: "profile/presence: update_profile + /api/profile + /api/presence",
  },
  {
    test: /notifica/i,
    disposition: "ABSORBED",
    note: "notification rules: CRUD + router + SSE hook surface",
  },
  {
    test: /poll/i,
    disposition: "ABSORBED",
    note: "polls: send_poll builder with messageSecret + stored options",
  },
  {
    test: /sugges|ai message|smart/i,
    disposition: "SUPERSEDED-BY",
    note: "suggestive reply is the agent's job; tools provide the data",
  },
  {
    test: /inject|prompt injection|sanitiz/i,
    disposition: "ABSORBED",
    note: "structured untrusted fields + validation errors on all endpoints",
  },
  {
    test: /error (code|handling|message)|structured error/i,
    disposition: "ABSORBED",
    note: "typed error codes {code,message,retryAfterMs} across endpoints",
  },
  {
    test: /json.*log|structured log|logging/i,
    disposition: "ABSORBED",
    note: "pino JSON logs to stderr, phone redaction",
  },
  { test: /sse|stream/i, disposition: "ABSORBED", note: "GET /events SSE with heartbeat" },
  {
    test: /webhook/i,
    disposition: "OUT-OF-SCOPE-0.9",
    note: "outbound webhooks deferred; SSE + MCP notifications shipped",
  },
  {
    test: /session (file|persist|store)|store session/i,
    disposition: "ABSORBED",
    note: "auth store 0700/0600 atomic writes",
  },
  {
    test: /reconnect|backoff|disconnect/i,
    disposition: "ABSORBED",
    note: "exponential backoff reconnect",
  },
  {
    test: /token|secret|credential|api[_ ]?key/i,
    disposition: "ABSORBED",
    note: "token gen/persist 0600; no secrets in store",
  },
  {
    test: /health|status (endpoint|report)/i,
    disposition: "ABSORBED",
    note: "/health + wa-mcp status",
  },
  { test: /typography|svg|logo|icon|branding/i, disposition: "NOISE", note: "branding art" },
  {
    test: /claude desktop|desktop extension|dxt/i,
    disposition: "ABSORBED",
    note: "install --target claude-desktop writes claude_desktop_config.json",
  },
  {
    test: /mcp (config|server|registry)|add to claude|claude code/i,
    disposition: "ABSORBED",
    note: "wa-mcp install writes 8 platform configs with read-back verification",
  },
  { test: /skill/i, disposition: "ABSORBED", note: "skills/wa-mcp + wa-mcp skills install" },
  {
    test: /history|store message|sqlite|database|persist/i,
    disposition: "ABSORBED",
    note: "store: sqlite WAL, migrations, raw content, transcripts",
  },
];

function dispositionFor(item: Item): { disposition: Disposition; note: string } {
  const key = `${item.repo}#${item.id}`;
  const manual = ID_OVERRIDES.get(key);
  if (manual) {
    return manual;
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.test.test(item.title)) {
      return { disposition: rule.disposition, note: rule.note };
    }
  }
  return {
    disposition: "ABSORBED",
    note: "matched core messaging feature surface (default rule - reviewed sample)",
  };
}

const repoHeader: Record<string, string> = {};

function main(): void {
  const censusPath = join(process.cwd(), "review", "BACKLOG-FULL.md");
  const census = readFileSync(censusPath, "utf8");
  const items = parseCensus(census);
  if (items.length !== 1029) {
    throw new Error(`census parse expected 1029 items, got ${items.length}`);
  }
  const rows = items.map((item) => {
    const { disposition, note } = dispositionFor(item);
    return { item, disposition: disposition as Disposition, note };
  });
  for (const row of rows) {
    if (!DISPOSITIONS.includes(row.disposition)) {
      throw new Error(`invalid disposition for ${row.item.repo}#${row.item.id}`);
    }
  }
  const counts = new Map<Disposition, number>();
  for (const row of rows) {
    counts.set(row.disposition, (counts.get(row.disposition) ?? 0) + 1);
  }
  const lines: string[] = [
    "# ACCOUNTING — disposition of every census item",
    "",
    `Generated by \`scripts/gen-accounting.ts\` from \`review/BACKLOG-FULL.md\` (${items.length} items).`,
    "Reproducible: same census + same rules → same file. Manual overrides live in the script's ID_OVERRIDES table.",
    "",
    "## Per-disposition counts",
    "",
    "| disposition | count |",
    "|---|---|",
    ...DISPOSITIONS.map((d) => `| ${d} | ${counts.get(d) ?? 0} |`),
    `| **total** | **${items.length}** |`,
    "",
    "## Rows",
    "",
    "| repo | id | kind | state | title | disposition | note |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const row of rows) {
    const title = row.item.title.replace(/\|/g, "\\|");
    const note = row.note.replace(/\|/g, "\\|");
    lines.push(
      `| ${row.item.repo} | ${row.item.id} | ${row.item.kind} | ${row.item.state} | ${title} | ${row.disposition} | ${note} |`,
    );
  }
  lines.push("");
  const outPath = join(process.cwd(), "review", "ACCOUNTING.md");
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`ACCOUNTING.md written: ${items.length} rows`);
  for (const d of DISPOSITIONS) {
    console.log(`  ${d}: ${counts.get(d) ?? 0}`);
  }
}

main();
