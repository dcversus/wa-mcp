import { escapeHtml } from "./escape.ts";
import { emptyState, initials } from "./pages.ts";

export type DeliveryMode = "inbox" | "session" | "spawn";

export interface SubscriptionView {
  id: string;
  name: string;
  chats: string[];
  filter: { like?: string; mentionOnly?: boolean };
  prompt?: string;
  delivery: {
    mode: DeliveryMode;
    session?: string;
    agent?: { command: string; args?: string[]; env?: Record<string, string> };
  };
  enabled: boolean;
  created: string;
  inboxPath?: string;
}

export interface SessionOption {
  id: string;
  label: string;
}

export interface ChatOption {
  jid: string;
  name: string | null;
}

export interface SubscriptionsPageView {
  subscriptions: SubscriptionView[];
  chats: ChatOption[];
  sessions: SessionOption[];
  editing: SubscriptionView | "new" | null;
  resolveName?: (jid: string) => string | null;
  error?: string;
}

export interface SubscriptionFormValues {
  name: string;
  chats: string[];
  allChats: boolean;
  /** adds the @contacts selector (every DM from a saved contact) */
  savedContacts?: boolean;
  like: string;
  mentionOnly: boolean;
  prompt: string;
  mode: string;
  session: string;
  command: string;
  args: string;
  env: string;
  enabled: boolean;
}

export const ALL_CHATS = "*";
/** every one-to-one chat with a saved contact (matched by PN and LID) */
export const SAVED_CONTACTS = "@contacts";

export const DELIVERY_OPTIONS: Array<{ mode: DeliveryMode; title: string; help: string }> = [
  {
    mode: "inbox",
    title: "Inbox file",
    help: "Each match is appended to an inbox.jsonl file — read it with wa-mcp inbox drain, or install a Claude Code hook that wakes your agent when it changes.",
  },
  {
    mode: "session",
    title: "Agent session",
    help: "Hand matches to any active Claude Code or Codex session, or to one session you pick from the list.",
  },
  {
    mode: "spawn",
    title: "New agent each time",
    help: "Start your agent CLI with a clean context for every match — the event JSON arrives in $WAMCP_EVENT and your prompt in $WAMCP_PROMPT.",
  },
];

export function likePreview(pattern: string): string {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    return "Every message";
  }
  if (!/(?<!\\)[%_]/.test(trimmed)) {
    return `Messages containing “${trimmed}” (any case)`;
  }
  return `Messages matching “${trimmed}” — % is any text, _ is one character (any case)`;
}

function chatLabel(jid: string, resolveName?: (jid: string) => string | null): string {
  if (jid === ALL_CHATS) {
    return "All chats";
  }
  return jid === SAVED_CONTACTS ? "Saved contacts (DMs)" : (resolveName?.(jid) ?? jid);
}

function deliveryBadge(sub: SubscriptionView, sessions: SessionOption[]): string {
  if (sub.delivery.mode === "session") {
    const id = sub.delivery.session;
    const label =
      id === undefined
        ? "any active session"
        : (sessions.find((session) => session.id === id)?.label ?? id);
    return `Session: ${label}`;
  }
  if (sub.delivery.mode === "spawn") {
    return `Spawn: ${sub.delivery.agent?.command ?? "?"}`;
  }
  return "Inbox";
}

function copyLine(command: string): string {
  return `<code>${escapeHtml(command)}</code> <button class="copy-cmd" type="button" data-copy-cmd="${escapeHtml(command)}">Copy</button>`;
}

function inboxWire(id: string, inboxPath: string): string {
  return `<div class="wire"><span class="wire-hint">Read new events, or let a hook wake Claude Code:</span>${copyLine(`wa-mcp inbox drain --inbox ${inboxPath}`)}${copyLine(`wa-mcp install --hooks claude --sub ${id}`)}</div>`;
}

export function subscriptionCardHtml(
  sub: SubscriptionView,
  resolveName: ((jid: string) => string | null) | undefined,
  sessions: SessionOption[],
): string {
  const id = escapeHtml(sub.id);
  const name = escapeHtml(sub.name);
  const chips = sub.chats
    .map((jid) => `<li class="chip">${escapeHtml(chatLabel(jid, resolveName))}</li>`)
    .join("");
  const badges = [
    ...(sub.filter.like !== undefined && sub.filter.like.length > 0
      ? [`<span class="badge badge-filter">~ ${escapeHtml(sub.filter.like)}</span>`]
      : []),
    ...(sub.filter.mentionOnly === true
      ? ['<span class="badge badge-filter">mentions only</span>']
      : []),
    `<span class="badge badge-delivery">${escapeHtml(deliveryBadge(sub, sessions))}</span>`,
  ].join("");
  const toggle = `<label class="check-row sub-toggle"><input type="checkbox" data-toggle-sub="${id}"${sub.enabled ? " checked" : ""} aria-label="Enabled: ${name}" /> ${sub.enabled ? "On" : "Off"}</label>`;
  const prompt =
    sub.prompt !== undefined && sub.prompt.length > 0
      ? `<p class="sub-prompt">Prompt: ${escapeHtml(sub.prompt)}</p>`
      : "";
  const wire =
    sub.delivery.mode === "inbox" && sub.inboxPath !== undefined
      ? inboxWire(sub.id, sub.inboxPath)
      : "";
  const actions = `<div class="sub-actions"><button type="button" data-edit-sub="${id}">Edit</button><button type="button" data-test-sub="${id}">Send test event</button><span class="test-status" data-test-status="${id}" aria-live="polite"></span><button class="danger" type="button" data-delete-sub="${id}" data-sub-name="${name}">Delete</button></div>`;
  return `<li class="sub-card" data-sub-id="${id}"><div class="sub-head"><strong class="sub-name">${name}</strong>${badges}${toggle}</div><ul class="chip-row" aria-label="Chats">${chips}</ul>${prompt}${wire}${actions}</li>`;
}

function chatPicker(selected: string[], chats: ChatOption[]): string {
  const known = new Set(chats.map((chat) => chat.jid));
  const extra = selected
    .filter((jid) => jid !== ALL_CHATS && jid !== SAVED_CONTACTS && !known.has(jid))
    .map((jid) => ({ jid, name: null }));
  const sorted = [...chats].sort((a, b) => {
    const groupOrder = (a.jid.endsWith("@g.us") ? 0 : 1) - (b.jid.endsWith("@g.us") ? 0 : 1);
    return groupOrder || (a.name ?? a.jid).localeCompare(b.name ?? b.jid);
  });
  const rows = [...extra, ...sorted]
    .map((chat) => {
      const label = chat.name ?? chat.jid;
      const checked = selected.includes(chat.jid) ? " checked" : "";
      return `<li class="sub-chat-row"><label class="check-row"><input type="checkbox" name="chats" value="${escapeHtml(chat.jid)}"${checked} /> <span class="avatar" aria-hidden="true">${escapeHtml(initials(label))}</span> <span class="chat-name" dir="auto">${escapeHtml(label)}</span></label></li>`;
    })
    .join("");
  return rows.length > 0
    ? `<ul id="sub-chat-picker">${rows}</ul>`
    : emptyState("No chats yet. They appear here once your phone finishes syncing.");
}

function modeConfig(
  mode: DeliveryMode,
  draft: SubscriptionView | null,
  sessions: SessionOption[],
): string {
  if (mode === "inbox") {
    return draft?.inboxPath !== undefined
      ? inboxWire(draft.id, draft.inboxPath)
      : '<p class="hint">The inbox path and the drain command appear after you save.</p>';
  }
  if (mode === "session") {
    const current = draft?.delivery.mode === "session" ? draft.delivery.session : undefined;
    const options = sessions
      .map(
        (session) =>
          `<option value="${escapeHtml(session.id)}"${session.id === current ? " selected" : ""}>${escapeHtml(session.label)}</option>`,
      )
      .join("");
    return `<label>Session<select name="session" aria-label="Agent session"><option value="">Any active session</option>${options}</select></label><p class="hint">Matches are spooled to the subscription's session.jsonl; the session's wa-mcp hook picks them up.</p>`;
  }
  const agent = draft?.delivery.mode === "spawn" ? draft.delivery.agent : undefined;
  const env = Object.entries(agent?.env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  return `<label>Command (CLI path)<input name="command" placeholder="/usr/local/bin/claude" autocomplete="off" value="${escapeHtml(agent?.command ?? "")}" /></label><label>Arguments, one per line<textarea name="args" rows="3" placeholder="-p">${escapeHtml((agent?.args ?? []).join("\n"))}</textarea></label><label>Environment, NAME=value per line<textarea name="env" rows="2" placeholder="ANTHROPIC_MODEL=opus">${escapeHtml(env)}</textarea></label>`;
}

export function subscriptionFormHtml(
  draft: SubscriptionView | null,
  chats: ChatOption[],
  sessions: SessionOption[],
): string {
  const mode = draft?.delivery.mode ?? "inbox";
  const selected = draft?.chats ?? [];
  const allChats = selected.includes(ALL_CHATS);
  const savedContacts = selected.includes(SAVED_CONTACTS);
  const like = draft?.filter.like ?? "";
  const heading = draft === null ? "New subscription" : `Edit “${escapeHtml(draft.name)}”`;
  const delivery = DELIVERY_OPTIONS.map(
    (option) =>
      `<label class="delivery-option"><input type="radio" name="mode" value="${option.mode}"${option.mode === mode ? " checked" : ""} /> <strong>${option.title}</strong> <span class="hint">${escapeHtml(option.help)}</span></label><div class="delivery-config" data-mode-config="${option.mode}"${option.mode === mode ? "" : " hidden"}>${modeConfig(option.mode, draft, sessions)}</div>`,
  ).join("");
  return `<form id="subscription-form" data-sub-id="${escapeHtml(draft?.id ?? "")}"><h2>${heading}</h2>
<fieldset><legend>1. Name and chats</legend><label>Name<input name="name" required autocomplete="off" aria-label="Subscription name" value="${escapeHtml(draft?.name ?? "")}" /></label><label class="check-row"><input type="checkbox" name="all_chats"${allChats ? " checked" : ""} /> All chats</label><label class="check-row"><input type="checkbox" name="saved_contacts"${savedContacts ? " checked" : ""} /> Every DM from a saved contact</label><input type="search" id="sub-chat-filter" placeholder="Search chats…" aria-label="Filter chats" autocomplete="off" />${chatPicker(selected, chats)}</fieldset>
<fieldset><legend>2. Filter</legend><label>Message text<input name="like" placeholder="%invoice%" autocomplete="off" aria-label="Message filter" aria-describedby="like-preview" value="${escapeHtml(like)}" /></label><p class="hint" id="like-preview">${escapeHtml(likePreview(like))}</p><label class="check-row"><input type="checkbox" name="mention_only"${draft?.filter.mentionOnly === true ? " checked" : ""} /> Only when my account is @mentioned</label></fieldset>
<fieldset><legend>3. Prompt</legend><label>System prompt your agent receives with the event<textarea name="prompt" rows="3" aria-label="Prompt">${escapeHtml(draft?.prompt ?? "")}</textarea></label></fieldset>
<fieldset><legend>4. Delivery</legend>${delivery}</fieldset>
<div class="form-actions"><button class="primary" type="submit">${draft === null ? "Create subscription" : "Save changes"}</button> <button type="button" data-cancel-sub>Cancel</button></div></form>`;
}

function deliveryHelpHtml(): string {
  const items = DELIVERY_OPTIONS.map(
    (option) => `<li><strong>${option.title}</strong> — ${escapeHtml(option.help)}</li>`,
  ).join("");
  return `<details class="delivery-help"><summary>Delivery options</summary><ul>${items}</ul><p class="hint">Same from the terminal: <code>wa-mcp subs create --name Team --chat &lt;jid&gt; --like %invoice% --mention-only --prompt "…" --delivery inbox|session|spawn</code> · <code>wa-mcp subs sessions</code> lists sessions to pick.</p></details>`;
}

export function subscriptionsPageHtml(view: SubscriptionsPageView): string {
  const error =
    view.error === undefined
      ? ""
      : `<div class="error-banner" role="alert">${escapeHtml(view.error)}</div>`;
  const form =
    view.editing === null
      ? ""
      : subscriptionFormHtml(
          view.editing === "new" ? null : view.editing,
          view.chats,
          view.sessions,
        );
  const list =
    view.subscriptions.length === 0
      ? emptyState("No subscriptions yet — create one to deliver WhatsApp messages to your agent.")
      : `<ul id="subscription-list" aria-label="Subscriptions">${view.subscriptions
          .map((sub) => subscriptionCardHtml(sub, view.resolveName, view.sessions))
          .join("")}</ul>`;
  return `<section id="subscriptions-page"><h1>Subscriptions</h1><p class="hint">A subscription picks chats, filters their incoming messages and hands the matches to your agent with your prompt.</p>${error}<div class="sub-toolbar"><button class="primary" id="new-subscription" type="button">New subscription</button></div>${form}<h2>Your subscriptions</h2>${list}${deliveryHelpHtml()}</section>`;
}

type FormResult = { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function readSubscriptionForm(
  values: SubscriptionFormValues,
  opts: { editing?: boolean } = {},
): FormResult {
  const name = values.name.trim();
  if (name.length === 0) {
    return { ok: false, message: "Give the subscription a name" };
  }
  const chats = values.allChats
    ? [ALL_CHATS]
    : [...(values.savedContacts === true ? [SAVED_CONTACTS] : []), ...values.chats];
  if (chats.length === 0) {
    return { ok: false, message: "Pick at least one chat, or tick All chats" };
  }
  const filter: Record<string, unknown> = {};
  if (values.like.trim().length > 0) {
    filter.like = values.like.trim();
  }
  if (values.mentionOnly) {
    filter.mentionOnly = true;
  }
  let delivery: Record<string, unknown> = { mode: "inbox" };
  if (values.mode === "session") {
    delivery =
      values.session.length > 0
        ? { mode: "session", session: values.session }
        : { mode: "session" };
  } else if (values.mode === "spawn") {
    const command = values.command.trim();
    if (command.length === 0) {
      return { ok: false, message: "Enter the agent command (CLI path) to start" };
    }
    const env: Record<string, string> = {};
    const envLines = values.env.split("\n");
    for (const [index, raw] of envLines.entries()) {
      const line = raw.trim();
      if (line.length === 0) {
        continue;
      }
      const at = line.indexOf("=");
      if (at <= 0) {
        return { ok: false, message: `Environment line ${index + 1} must look like NAME=value` };
      }
      env[line.slice(0, at)] = line.slice(at + 1);
    }
    const args = lines(values.args);
    delivery = {
      mode: "spawn",
      agent: {
        command,
        ...(args.length > 0 ? { args } : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      },
    };
  }
  const prompt = values.prompt.trim();
  return {
    ok: true,
    value: {
      name,
      chats,
      filter,
      ...(prompt.length > 0 ? { prompt } : opts.editing === true ? { prompt: null } : {}),
      delivery,
      enabled: values.enabled,
    },
  };
}
