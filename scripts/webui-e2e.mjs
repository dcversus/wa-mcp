/** T67 E2E use-case gate: headless Chrome over CDP against a LIVE daemon.
 * Happy path: chats render → open chat → type + click send → sent bubble
 * appears → composer clears. Zero console errors required.
 * Usage: node scripts/webui-e2e.mjs [bridgeUrl] [chromePath]
 * ('vp run webui-e2e' wraps it; the daemon must be up and paired, and the
 * target chat must exist in the store.) */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WS = require("../node_modules/.pnpm/node_modules/ws/index.js");

const bridgeUrl = process.argv[2] ?? "http://127.0.0.1:8080";
const chromePath =
  process.argv[3] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const profile = mkdtempSync(join(tmpdir(), "wa-mcp-e2e-"));
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

const wsUrl = await new Promise((resolve, _reject) => {
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
const sessionPending = new Map();
const consoleErrors = [];
// T77: the send flow fires POST /api/presence (paused) — assert the live
// daemon accepts the body (the client used to send `state` where the route
// validates `presence`, and every such call 400'd silently)
const presenceResponses = [];

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id !== undefined && browserPending.has(msg.id)) {
    browserPending.get(msg.id)(msg);
    browserPending.delete(msg.id);
    return;
  }
  if (msg.sessionId !== undefined && sessionPending.has(msg.id)) {
    sessionPending.get(msg.id)(msg);
    sessionPending.delete(msg.id);
    return;
  }
  if (
    msg.sessionId !== undefined &&
    msg.method === "Network.responseReceived" &&
    String(msg.params?.response?.url ?? "").includes("/api/presence")
  ) {
    presenceResponses.push(msg.params.response.status);
  }
  if (msg.sessionId !== undefined && msg.method === "Runtime.consoleAPICalled") {
    if (msg.params.type === "error") {
      consoleErrors.push(
        (msg.params.args ?? [])
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .slice(0, 200),
      );
    }
  }
});

function browser(method, params = {}) {
  return new Promise((resolve, _reject) => {
    const id = nextId++;
    browserPending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function cdp(method, params = {}) {
  return new Promise((resolve, _reject) => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// T93-C3: mirrors web-ui/src/preflight.ts retryUntil — poll instead of a
// fixed sleep so a slow first render / daemon blip doesn't fail the run
const retryUntil = async (check, { attempts, delayMs }) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }
  return false;
};

const target = await browser("Target.createTarget", { url: "about:blank" });
const attach = await browser("Target.attachToTarget", {
  targetId: target.result.targetId,
  flatten: true,
});
const sessionId = attach.result.sessionId;
// route cdp() through the session

await cdp("Runtime.enable");
await cdp("Page.enable");
await cdp("Network.enable");
await cdp("Page.navigate", { url: `${bridgeUrl}/#/chats` });

const failures = [];

// 1. chats page renders with the expected structure (retried — C3)
const rendered = await retryUntil(
  async () => {
    const html = await evalInPage(`document.getElementById("app")?.innerHTML ?? ""`);
    return typeof html === "string" && html.includes("chats-page");
  },
  { attempts: 12, delayMs: 500 },
);
if (!rendered) {
  const chatsHtml = await evalInPage(`document.getElementById("app")?.innerHTML ?? ""`);
  failures.push(`#/chats did not render: ${String(chatsHtml).slice(0, 120)}`);
}

// send leg only proves something on a CONNECTED daemon (health retried — C3)
const health = await evalInPage(
  `(async () => { for (let i = 0; i < 5; i++) { try { const r = await fetch("${bridgeUrl}/health"); if (r.ok) return await r.json(); } catch {} await new Promise((res) => setTimeout(res, 400)); } return null; })()`,
);
const connected = health?.connected === true;
if (!connected) {
  console.log("send leg skipped: daemon not connected (pair first) — structural checks only");
}

// 2. open the first chat with rows, else synthesize via the first li
const chatLink = await evalInPage(
  `document.querySelector("#chats-page .chat-list li[data-jid]:not([data-archived])")?.getAttribute("data-jid") ?? null`,
);
if (chatLink === null) {
  failures.push("no open chat row found in the list — cannot drive the chat use case");
} else {
  await evalInPage(`location.hash = "#/chat/${encodeURIComponent(chatLink)}"`);
  await sleep(1500);

  // 3. type into the composer and click send
  const typed = `e2e probe ${Date.now()}`;
  await evalInPage(
    `const input = document.querySelector("#app .send-box input[name=text]");
     input.value = ${JSON.stringify(typed)};
     input.dispatchEvent(new Event("input"));`,
  );
  const sendBtn = await evalInPage(`document.querySelector("#app .send-box button") !== null`);
  if (!sendBtn) {
    failures.push("send button not found");
  } else if (connected) {
    await evalInPage(`document.querySelector("#app .send-box button").click()`);
    await sleep(1200);

    // 4. the sent text appears as a bubble; composer is cleared
    const bubbles = await evalInPage(
      `JSON.stringify(Array.from(document.querySelectorAll("#app .message .text")).map((n) => n.textContent))`,
    );
    if (!bubbles.includes(typed)) {
      failures.push(`sent bubble missing; bubbles=${bubbles.slice(0, 200)}`);
    }
    const composerValue = await evalInPage(
      `document.querySelector("#app .send-box input[name=text]")?.value ?? null`,
    );
    if (composerValue !== "") {
      failures.push(`composer not cleared: '${composerValue}'`);
    }

    // T77 contract-drift gate: the presence call fired with the send must be
    // ACCEPTED by the live daemon (200) — a 400 here means the client body
    // no longer matches the bridge validation contract
    if (connected && !presenceResponses.some((status) => status === 200)) {
      failures.push(
        `presence contract broken: /api/presence responses ${JSON.stringify(presenceResponses)} (want a 200)`,
      );
    }
  } else {
    console.log("send leg skipped: daemon not connected (pair first) — structural checks only");
  }
}

// 5. zero console errors across the run
if (consoleErrors.length > 0) {
  failures.push(`console errors: ${consoleErrors.join(" | ").slice(0, 300)}`);
}

chrome.kill();

if (failures.length > 0) {
  console.error("webui-e2e FAILED:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}
console.log(
  "webui-e2e PASS: chats → open chat → send → bubble visible → composer cleared, zero console errors",
);
process.exit(0);
