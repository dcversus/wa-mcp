import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bridgeUrl = process.argv[2] ?? "http://127.0.0.1:8080";
const chromePath =
  process.argv[3] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outPath = process.argv[4] ?? "/tmp/webui-dogfood-report.json";

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WS = require("../node_modules/.pnpm/node_modules/ws/index.js");

const profile = mkdtempSync(join(tmpdir(), "wa-mcp-dogfood-"));
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

const wsUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("chrome ws timeout")), 10000);
  chrome.stderr.on("data", (c) => {
    const m = /ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[0-9a-f-]+/.exec(c.toString());
    if (m) {
      clearTimeout(t);
      resolve(m[0]);
    }
  });
});

const ws = new WS(wsUrl);
await new Promise((r) => ws.on("open", r));

let nextId = 1;
const browserPending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id !== undefined && browserPending.has(msg.id)) {
    browserPending.get(msg.id)(msg);
    browserPending.delete(msg.id);
  }
});

function browser(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    browserPending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const target = await browser("Target.createTarget", { url: "about:blank" });
const attach = await browser("Target.attachToTarget", {
  targetId: target.result.targetId,
  flatten: true,
});
const sessionId = attach.result.sessionId;

const sessionPending = new Map();
const consoleErrors = [];
const failedRequests = [];

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.sessionId === sessionId && msg.id !== undefined && sessionPending.has(msg.id)) {
    sessionPending.get(msg.id)(msg);
    sessionPending.delete(msg.id);
    return;
  }
  if (msg.sessionId === sessionId && msg.method) {
    if (
      msg.method === "Runtime.consoleAPICalled" &&
      (msg.params.type === "error" || msg.params.type === "warning")
    ) {
      consoleErrors.push(
        (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .slice(0, 200),
      );
    }
    if (msg.method === "Network.loadingFailed" && !msg.params.canceled) {
      failedRequests.push(msg.params.errorText);
    }
  }
});

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => {
      sessionPending.delete(id);
      reject(new Error(`cdp timeout: ${method}`));
    }, 15000);
    sessionPending.set(id, (msg) => {
      clearTimeout(t);
      resolve(msg);
    });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function evalInPage(expression) {
  const r = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.result?.exceptionDetails) {
    return { __error: r.result.exceptionDetails.text };
  }
  return r.result?.result?.value;
}

await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Page.enable");

await cdp("Page.navigate", { url: bridgeUrl });
await new Promise((r) => setTimeout(r, 3000));

const inspectExpr = `JSON.stringify({
  route: location.hash,
  title: document.title,
  appChildren: document.querySelector('#app')?.children.length ?? -1,
  bodyText: document.body.innerText.replace(/\\n+/g, ' | ').slice(0, 500),
  buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 15),
  inputs: [...document.querySelectorAll('input, textarea, select')].map(i => i.placeholder || i.name || i.type).slice(0, 10),
  links: [...document.querySelectorAll('a')].map(a => a.getAttribute('href')).slice(0, 12),
  imgCount: document.images.length,
  brokenImgs: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src.split('/').pop()).slice(0, 5),
  scrollH: document.body.scrollHeight,
})`;

const routes = [
  ["#/ (root)", "location.hash = '#/'; location.reload()"],
  ["#/pairing", "location.hash = '#/pairing'"],
  ["#/chats", "location.hash = '#/chats'"],
  ["#/chat/<jid>", "location.hash = '#/chat/' + encodeURIComponent('351930017568@s.whatsapp.net')"],
  ["#/contacts", "location.hash = '#/contacts'"],
  ["#/profile", "location.hash = '#/profile'"],
  ["#/groups", "location.hash = '#/groups'"],
  ["#/events", "location.hash = '#/events'"],
  ["#/settings", "location.hash = '#/settings'"],
  ["#/nonexistent", "location.hash = '#/definitely-not-a-route'"],
];

const findings = [];
for (const [label, expr] of routes) {
  try {
    await evalInPage(expr);
    await new Promise((r) => setTimeout(r, 1500));
    const before = consoleErrors.length;
    const reqBefore = failedRequests.length;
    const snap = await evalInPage(inspectExpr);
    const parsed = typeof snap === "string" ? JSON.parse(snap) : { __error: snap };
    findings.push({
      route: label,
      ...parsed,
      consoleErrors: consoleErrors.slice(before),
      failedRequests: failedRequests.slice(reqBefore),
    });
    console.log(
      `=== ${label}: children=${parsed.appChildren} title="${parsed.title}" scrollH=${parsed.scrollH}`,
    );
    console.log(`    text: ${(parsed.bodyText ?? "").slice(0, 180)}`);
    if (parsed.consoleErrors?.length)
      console.log(`    CONSOLE: ${JSON.stringify(parsed.consoleErrors)}`);
    if (parsed.failedRequests?.length)
      console.log(`    FAILED: ${JSON.stringify(parsed.failedRequests)}`);
    if (parsed.brokenImgs?.length)
      console.log(`    BROKEN IMGS: ${JSON.stringify(parsed.brokenImgs)}`);
  } catch (e) {
    console.log(`=== ${label}: FAILED ${e.message}`);
    findings.push({ route: label, error: e.message });
  }
}

writeFileSync(outPath, JSON.stringify(findings, null, 2));
console.log(`\nreport: ${outPath}`);
chrome.kill();
process.exit(0);
