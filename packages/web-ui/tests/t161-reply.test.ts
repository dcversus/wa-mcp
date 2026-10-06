import { expect, test } from "vite-plus/test";
import { replyPreviewHtml } from "../src/pages.ts";

test("T161 W4 — the reply preview names the quoted message and cancels", () => {
  const html = replyPreviewHtml({ senderName: "Dana", text: "<script>x</script> first words" });
  expect(html).toContain('id="reply-preview"');
  expect(html).toContain('id="cancel-reply"');
  expect(html).toContain("Dana");
  expect(html).not.toContain("<script>x</script>");
  expect(html).toContain("first words");
});
