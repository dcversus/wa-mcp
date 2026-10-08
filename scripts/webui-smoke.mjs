// CDP-based web UI smoke: loads the served bundle in headless Chrome and
// asserts the SPA actually renders. Usage:
//   node scripts/webui-smoke.mjs [bridgeUrl] [chromePath]
// Exits 0 when #/pairing and #/settings render non-empty content with
// no token set; non-zero with a diagnostic otherwise.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bridgeUrl = process.argv[2] ?? "http://127.0.0.1:8080";
const sessionToken = process.argv[4] ?? "smoke-token";
const chromePath =
  process.argv[3] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profile = mkdtempSync(join(tmpdir(), "wa-mcp-smoke-profile-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const devtoolsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("chrome did not expose a debug port within 10s")),
    10_000,
  );
  const handle = (data) => {
    const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  };
  chrome.stderr.on("data", handle);
  chrome.stdout.on("data", handle);
});

const ws = new WebSocket(devtoolsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("browser websocket error"));
});

let nextId = 1;
const pending = new Map();
let pageSession = null;

const eventWaiters = [];
const pageDiagnostics = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id !== undefined && pending.has(msg.id)) {
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    pageDiagnostics.push(
      `console.${msg.params.type}: ${msg.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`,
    );
  }
  if (msg.method === "Runtime.exceptionThrown") {
    pageDiagnostics.push(
      `page exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`,
    );
  }
  for (let index = eventWaiters.length - 1; index >= 0; index -= 1) {
    const waiter = eventWaiters[index];
    if (
      waiter.method === msg.method &&
      (waiter.sessionId === undefined || waiter.sessionId === msg.sessionId)
    ) {
      eventWaiters.splice(index, 1);
      waiter.resolve(msg.params);
    }
  }
};

function waitForEvent(method, sessionId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`event timeout: ${method}`)), 8000);
    eventWaiters.push({
      method,
      sessionId,
      resolve: (params) => {
        clearTimeout(timer);
        resolve(params);
      },
    });
  });
}

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const attached = await send("Target.attachToTarget", { targetId, flatten: true });
pageSession = attached.sessionId;
await pageCall("Page.enable");

function pageCall(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId: pageSession }));
  });
}

async function evaluate(expression) {
  const result = await pageCall("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "page exception");
  }
  return result.result.value;
}

async function goto(url) {
  const loaded = waitForEvent("Page.loadEventFired", pageSession);
  await pageCall("Page.navigate", { url });
  await loaded.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

function fail(message) {
  console.error(`webui-smoke FAILED: ${message}`);
  chrome.kill();
  process.exit(1);
}

await goto(`${bridgeUrl}/#/pairing`);
await evaluate("try { localStorage.clear(); } catch {}");
await goto(`${bridgeUrl}/#/pairing`);

await evaluate(
  `window.addEventListener("error", (event) => console.error("window error:", event.message)); window.addEventListener("unhandledrejection", (event) => console.error("unhandled:", String(event.reason)));`,
);
const pairingApp = await evaluate(`document.getElementById("app")?.innerHTML ?? ""`);
const scriptInfo = await evaluate(
  `Array.from(document.scripts).map((script) => script.src).join(", ")`,
);
console.log(`scripts: ${scriptInfo}`);
for (const line of pageDiagnostics) {
  console.log(`diag: ${line}`);
}
if (pairingApp.length === 0) {
  const probe = await evaluate(`(async () => {
    const before = document.getElementById("app")?.innerHTML.length ?? -1;
    let hashChanges = 0;
    window.addEventListener("hashchange", () => { hashChanges += 1; });
    location.hash = "#/settings";
    await new Promise((resolve) => setTimeout(resolve, 800));
    return {
      before,
      after: document.getElementById("app")?.innerHTML.length ?? -1,
      hashChanges,
      hash: location.hash,
      settingsStored: localStorage.getItem("wa-mcp-settings"),
    };
  })()`);
  console.log(`deadlock probe: ${JSON.stringify(probe)}`);
  fail("#/pairing rendered an empty #app");
}
console.log(`#/pairing app innerHTML length: ${pairingApp.length}`);
console.log(`#/pairing app content: ${pairingApp.slice(0, 200)}`);
for (const line of pageDiagnostics.slice(-8)) {
  console.log(`diag(pairing): ${line}`);
}
if (pairingApp.includes('id="settings-form"') || pairingApp.includes('id="token"'))
  fail("#/pairing still shows a token wall (T53: pairing must be tokenless)");
if (!pairingApp.includes('id="pairing"')) fail("#/pairing is missing the pairing/qr container");
if (
  !pairingApp.includes("pane-methods") &&
  !pairingApp.includes("pane-connecting") &&
  !pairingApp.includes("pane-blocked")
)
  fail("#/pairing does not render a pairing flow pane (T53)");
const pairingHash = await evaluate(`location.hash`);
if (!String(pairingHash).startsWith("#/pairing"))
  fail(`#/pairing redirected away to ${pairingHash} (T39 no-redirect contract)`);
console.log(`#/pairing flow renders tokenless + no redirect: ok (hash=${pairingHash})`);
console.log(
  `#/pairing DOM: ${pairingApp.slice(0, 260)}... | localStorage wa-mcp-settings=${await evaluate(
    `localStorage.getItem("wa-mcp-settings")`,
  )}`,
);

await goto(`${bridgeUrl}/#/settings`);
const settingsApp = await evaluate(`document.getElementById("app")?.innerHTML ?? ""`);
if (!settingsApp.includes('id="settings-form"'))
  fail("#/settings did not render the settings form");
if (!settingsApp.includes('id="bridge-url"') || !settingsApp.includes('id="token"')) {
  fail("#/settings is missing the bridge-url/token inputs");
}
console.log(`#/settings form rendered: ok`);

const nav = await evaluate(`document.getElementById("nav")?.innerHTML ?? ""`);
if (!nav.includes("#/contacts")) fail("nav is empty");
console.log(`nav rendered: ok (${nav.length} chars)`);

// ---- T54: tokenless #/contacts renders on the SAME route (no redirect,
// no token wall); with a stored token the contacts page renders too.
const isContactsOrPairing = (html) =>
  html.includes("contacts-page") || html.includes('id="pairing"');
await goto(`${bridgeUrl}/#/contacts`);
const inlineForm = await evaluate(`document.getElementById("app")?.innerHTML ?? ""`);
const inlineHash = await evaluate(`location.hash`);
if (inlineForm.includes('id="settings-form"') || inlineForm.includes('id="token"'))
  fail("#/contacts still shows a token form (T54 revised: the ephemeral UI token authenticates)");
if (!isContactsOrPairing(inlineForm))
  fail(`#/contacts did not render tokenless: ${inlineForm.slice(0, 120)}`);
if (!String(inlineHash).startsWith("#/contacts"))
  fail(`#/contacts redirected away to ${inlineHash} (T54 no-redirect contract)`);
console.log(`#/contacts tokenless → page via UI token, hash stays: ok (hash=${inlineHash})`);
await goto(`${bridgeUrl}/#/chats`);
const redirected = await evaluate(`location.hash`);
if (redirected !== "#/contacts") fail(`#/chats should redirect to #/contacts, got ${redirected}`);
console.log(`#/chats redirects to #/contacts: ok`);
await evaluate(
  `localStorage.setItem("wa-mcp-settings", JSON.stringify({ bridgeUrl: "${bridgeUrl}", token: "${sessionToken}" }))`,
);
await goto(`${bridgeUrl}/#/contacts`);
let contactsPage = await evaluate(`document.getElementById("app")?.innerHTML ?? ""`);
for (let attempt = 0; attempt < 10; attempt += 1) {
  if (isContactsOrPairing(contactsPage)) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
  contactsPage = await evaluate(`document.getElementById("app")?.innerHTML ?? ""`);
}
console.log(`#/contacts app html: ${contactsPage.slice(0, 120)}`);
if (!isContactsOrPairing(contactsPage))
  fail(`#/contacts with a stored token did not render: ${contactsPage.slice(0, 120)}`);
console.log(`#/contacts with stored token renders the page: ok`);
for (const line of pageDiagnostics.slice(-12)) {
  console.log(`diag: ${line}`);
}
chrome.kill();
console.log("webui-smoke PASS");
process.exit(0);
