import {
  CLI_COMMANDS,
  CLI_GLOBAL_FLAGS,
  CLI_GROUP_LABELS,
  type CliGroup,
} from "../../shared/src/cli-reference.ts";
import { escapeHtml } from "./escape.ts";
import { NAV_TITLES } from "./pages.ts";

const WHAT = `<div class="panel" id="help-what"><h2>What is this?</h2><p>wa-mcp is a WhatsApp bridge that runs on your own computer. It links to your WhatsApp account the way WhatsApp Web does, keeps your messages in a local database, and lets you — and the AI agents you connect — read, search and send messages. Nothing leaves this machine except the WhatsApp connection itself.</p></div>`;

const START = `<div class="panel" id="help-start"><h2>Getting started</h2><ol class="help-steps">
<li><strong>Link your phone.</strong> Open <a href="#/connection">Connection</a> and choose a QR code or a phone-number code, then on your phone go to Settings → Linked devices → Link a device. From a terminal: <code>wa-mcp pair</code>.</li>
<li><strong>Create your first subscription.</strong> In <a href="#/subscriptions">Subscriptions</a>, pick the chats to watch, optionally a text filter or mention-only, write the prompt your agent should get, and choose how events are delivered. From a terminal: <code>wa-mcp subs create --name Team --chat &lt;jid&gt; --prompt "…"</code>.</li>
<li><strong>Connect an agent.</strong> <code>wa-mcp install</code> registers the WhatsApp tools with your AI agents; <code>wa-mcp install --hooks claude --sub &lt;subscription-id&gt;</code> wakes Claude Code whenever the subscription delivers an event. Check what is connected in <a href="#/agents">Agents</a>.</li>
</ol></div>`;

const CONCEPTS = `<div class="panel" id="help-concepts"><h2>Concepts</h2>
<h3><a href="#/logs">Logs</a></h3><p>Every message in and out, newest first. Filter by chat, person, direction, date range or text; turn on live tail to watch new messages arrive. Click a chat name to open that conversation. CLI: <code>wa-mcp messages</code>.</p>
<h3><a href="#/contacts">Contacts</a></h3><p>Your real WhatsApp contacts. Adding, renaming and removing contacts works exactly like WhatsApp Web — the change is on your phone too. Search by name, username or number, and click a contact to open your conversation with them. CLI: <code>wa-mcp contacts</code>.</p>
<h3><a href="#/agents">Agents</a></h3><p>The AI agents wired to this WhatsApp: hooks that deliver subscription events, and MCP server registrations that give an agent the WhatsApp tools. Agents whose app is not on this computer say <em>App not installed</em> and sort last. <em>View logs</em> opens the Logs page filtered to what that agent sent and received. Disconnect removes only wa-mcp's own entries from the agent's config (a backup is written first). CLI: <code>wa-mcp connections</code>.</p>
<h3><a href="#/subscriptions">Subscriptions</a></h3><p>A subscription decides which incoming messages reach an agent, and how.</p>
<dl class="help-terms">
<dt>Chats</dt><dd>One or more chats, or all chats.</dd>
<dt>Text filter (%like%)</dt><dd><code>%</code> matches any text and <code>_</code> one character, ignoring case; a pattern without wildcards matches anywhere in the message.</dd>
<dt>Mention-only</dt><dd>Deliver only messages that @mention you.</dd>
<dt>Prompt</dt><dd>Instructions stamped into every delivered event, so the agent knows what to do with it.</dd>
<dt>Inbox file</dt><dd>Each match becomes one line in the subscription's inbox file; hooks or <code>wa-mcp inbox drain</code> read it.</dd>
<dt>Agent session</dt><dd>Matches are queued for a running Claude Code or Codex session — the active one, or one you pick.</dd>
<dt>New agent each time</dt><dd>Each match starts your agent command with a clean context; the event is in <code>$WAMCP_EVENT</code> and the prompt in <code>$WAMCP_PROMPT</code>.</dd>
</dl>
<h3><a href="#/profile">Profile</a></h3><p>Your WhatsApp name, about text, privacy settings and blocked contacts — the same settings as on your phone. CLI: <code>wa-mcp profile</code>.</p>
<h3><a href="#/connection">Connection settings</a></h3><p>Link status, today's message counts and how this connection sends. Both settings are off by default. CLI: <code>wa-mcp settings</code>.</p>
<dl class="help-terms">
<dt>Humanisation</dt><dd>Waits before each message as if typing it — a base delay plus time per character, capped, with ±20% randomness — and shows “typing…” in the chat meanwhile.</dd>
<dt>Send limits</dt><dd>Caps sends per minute, hour and day, and optionally per chat per day, to stay clear of WhatsApp's anti-spam checks. Over a limit a send is refused with a retry time instead of going out.</dd>
</dl></div>`;

const TROUBLE = `<div class="panel" id="help-troubleshooting"><h2>Troubleshooting</h2><dl class="help-terms">
<dt>WhatsApp is not linked</dt><dd>Open <a href="#/connection">Connection</a> and link with a QR code or a phone-number code (<code>wa-mcp pair</code>). If linking was blocked after several attempts, wait before retrying — every attempt restarts WhatsApp's cooldown — then use <code>wa-mcp pair --resume</code>.</dd>
<dt>401 — the access key was rejected</dt><dd>The web UI signs in by itself with a key the bridge hands it, and drops a stale key on its own. Reload the page; if the bridge was restarted, reopen the web UI from the link the bridge prints at start. The CLI reads <code>~/.wa-mcp/token</code>.</dd>
<dt>429 — SEND_LIMIT_REACHED or RATE_LIMITED</dt><dd>A send limit was reached; the error says which one and when to retry. Raise or switch off the limits in <a href="#/connection">Connection</a> (<code>wa-mcp settings set --per-day &lt;n&gt;</code>), or wait. <code>RATE_LIMITED</code> means requests came too fast — space them out.</dd>
<dt>A subscription never fires</dt><dd>Check it is switched on and watches the right chat in <a href="#/subscriptions">Subscriptions</a>. A text filter must match the message, and mention-only needs an @mention of you. Use <em>Send test event</em> (<code>wa-mcp subs test &lt;id&gt;</code>) to check delivery, and <a href="#/logs">Logs</a> to confirm the message arrived. Your own messages and old history are never delivered.</dd>
</dl></div>`;

function cliHtml(): string {
  const groups = (Object.keys(CLI_GROUP_LABELS) as CliGroup[])
    .map((group) => {
      const rows = CLI_COMMANDS.filter((command) => command.group === group)
        .map((command) => {
          const page =
            command.web === undefined
              ? ""
              : ` · in the web UI: <a href="${command.web}">${escapeHtml(NAV_TITLES[command.web.slice(2)] ?? command.web)}</a>`;
          return `<dt><code>wa-mcp ${escapeHtml(command.usage)}</code></dt><dd>${escapeHtml(command.summary)}${page}</dd>`;
        })
        .join("");
      return `<h3>${escapeHtml(CLI_GROUP_LABELS[group])}</h3><dl class="help-cli">${rows}</dl>`;
    })
    .join("");
  return `<div class="panel" id="help-cli"><h2>Command line</h2><p class="hint">Everything here can also be done from a terminal with <code>wa-mcp</code>. Flags every command accepts: <code>${escapeHtml(CLI_GLOBAL_FLAGS)}</code>.</p>${groups}</div>`;
}

export function helpPageHtml(): string {
  return `<section id="help-page"><h1>Help</h1>${WHAT}${START}${CONCEPTS}${cliHtml()}${TROUBLE}</section>`;
}
