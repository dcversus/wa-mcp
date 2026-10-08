import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { chatListHtml } from "../src/pages.ts";

test("T159 W8 — the archived CSS selector matches the markup the page writes", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.chat-list\.hide-archived li\[data-archived="1"\]/);
  const html = chatListHtml(
    [
      { jid: "a@g.us", name: "A", unreadCount: 0, archived: true },
      { jid: "b@g.us", name: "B", unreadCount: 0, archived: false },
    ],
    { showArchived: false },
  );
  expect(html).toContain('data-archived="1"');
  expect(html).toContain("chat-list hide-archived");
});
