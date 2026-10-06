import { escapeHtml } from "./escape.ts";
import { agentConnectHtml } from "./pages.ts";

export type PairingPane = "methods" | "blocked" | "connecting" | "paired" | "error";

export interface PairingHealth {
  pairingToken?: string;
  /** T94-G: the STABLE bootstrap credential (data-dir persisted) — present
   * even on a paired daemon so a fresh browser bootstraps with no action */
  uiBootstrapToken?: string;
  status?: string;
  connected?: boolean;
  loggedIn?: boolean;
  pairingBlocked?: boolean;
  pairingAttempts?: { used: number; limit: number };
}

export interface PairingQr {
  qr: string | null;
  png: string | null;
}

export interface PairingView {
  pane: PairingPane;
  health: PairingHealth;
  qr: PairingQr;
  countdownPct: number;
  code?: string | null;
  me?: string | null;
  error?: string | null;
  intro?: string | null;
}

export interface LinkedAccount {
  name: string | null;
  pn: string | null;
}

export function pairedIdentityText(me: LinkedAccount | null): string | null {
  if (me === null) {
    return null;
  }
  if (me.name !== null && me.pn !== null) {
    return `${me.name} (+${me.pn})`;
  }
  if (me.name !== null) {
    return me.name;
  }
  return me.pn !== null ? `+${me.pn}` : null;
}

/** Pane precedence: a completed pairing wins, then an explicit engine error,
 * then the anti-abuse block, then the interactive methods. */
/** T75: whether a QR can exist at all — once the account is logged in the
 * pairing flow is finished and polling /api/qr would only drain buckets. */
export function pairingPossible(health: PairingHealth): boolean {
  if (health.loggedIn === true || health.connected === true || health.status === "connected") {
    return false;
  }
  return true;
}

export function pairingState(
  health: PairingHealth,
  qr: PairingQr,
  code?: string | null,
  error?: string | null,
): PairingPane {
  if (health.connected === true) {
    return "paired";
  }
  if (error) {
    return "error";
  }
  if (health.pairingBlocked === true) {
    return "blocked";
  }
  if (qr.qr !== null || qr.png !== null || code) {
    return "methods";
  }
  return "connecting";
}

/** Linear countdown for the QR ref lifetime, clamped to [0,100]. */
export function qrCountdownPct(expiresInMs: number, nowMs: number, totalMs: number): number {
  if (totalMs <= 0) {
    return 0;
  }
  const remaining = Math.max(0, Math.min(totalMs, expiresInMs - nowMs));
  return Math.round((remaining / totalMs) * 100);
}

const METHOD_HINT = "WhatsApp → Settings → Linked devices → Link a device";

export function pairingHtml(view: PairingView): string {
  const intro =
    typeof view.intro === "string" && view.intro.length > 0
      ? `<p class="hint">${escapeHtml(view.intro)}</p>`
      : "";
  const head = `<h2>Pairing</h2>${intro}<p class="hint">${METHOD_HINT}</p>`;
  if (view.pane === "paired") {
    return `<section id="pairing" class="pane pane-paired">${head}<p class="ok">paired as <strong>${escapeHtml(view.me ?? "this device")}</strong> — head to <a href="#/chats">Chats</a></p>${agentConnectHtml()}</section>`;
  }
  if (view.pane === "error") {
    return `<section id="pairing" class="pane pane-error">${head}<p class="danger">pairing error: ${escapeHtml(view.error ?? "unknown error")}</p><button id="pairing-retry" type="button">try again</button></section>`;
  }
  if (view.pane === "blocked") {
    const attempts = view.health.pairingAttempts ?? { used: 0, limit: 0 };
    return `<section id="pairing" class="pane pane-blocked">${head}
<div class="blocked-box">
<p class="danger">pairing attempts exhausted — ${attempts.used} of ${attempts.limit} registrations without pairing.</p>
<p>WhatsApp's anti-abuse cooldown resets on every attempt, so retrying now deepens the lockout. Wait for the cooldown to clear, then resume — or restart the daemon.</p>
<button id="resume-pairing" data-resume="1">Resume pairing</button>
</div></section>`;
  }
  if (view.pane === "connecting") {
    return `<section id="pairing" class="pane pane-connecting">${head}<div class="spinner"></div><p id="connecting-note">connecting to WhatsApp…</p></section>`;
  }
  const qrImage =
    view.qr.png !== null
      ? `<img id="qr-image" alt="WhatsApp pairing QR" src="data:image/png;base64,${escapeHtml(view.qr.png)}" />`
      : `<p class="danger">no QR available yet — waiting for the daemon…</p>`;
  const linkValue = view.qr.qr ?? "";
  const code = view.code ?? "";
  const codeForm =
    code.length > 0
      ? ""
      : `<form id="phone-form"><label>your phone number (with country code, digits only)<input id="phone-input" name="phone" inputmode="numeric" autocomplete="tel" placeholder="e.g. 447700900123" /></label><button type="submit">get pairing code</button></form>`;
  const codeBox = `<div id="pairing-code-display" class="code-display">${code.length > 0 ? escapeHtml(code) : "····-····"}</div>${code.length > 0 ? `<ol class="code-steps"><li>open WhatsApp on your phone</li><li>Settings → Linked devices → <strong>Link with phone number instead</strong></li><li>enter the code above</li></ol>` : ""}${codeForm}`;
  return `<section id="pairing" class="pane pane-methods">${head}
<div class="pairing-grid">
<div class="method"><h3>1 · QR code</h3>${qrImage}<div id="qr-countdown" class="countdown" data-pct="${view.countdownPct}"><div class="countdown-fill" style="width:${view.countdownPct}%"></div></div></div>
<div class="method"><h3>2 · Phone number code</h3>${codeBox}</div>
<div class="method"><h3>3 · Copy-paste link</h3><p>paste this into your phone's browser:</p><input id="link-input" readonly value="${escapeHtml(linkValue)}" /><button class="copy-btn" data-copy-url="${escapeHtml(linkValue)}">copy link</button></div>
</div>
<p class="resume-row">registrations used: ${escapeHtml(String(view.health.pairingAttempts?.used ?? 0))}/${escapeHtml(String(view.health.pairingAttempts?.limit ?? 0))} <button id="resume-pairing" data-resume="1">Resume pairing</button></p>
</section>`;
}
