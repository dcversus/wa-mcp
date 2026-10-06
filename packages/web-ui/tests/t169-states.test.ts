import { expect, test } from "vite-plus/test";
import { ApiError } from "../src/api.ts";
import { errorBannerHtml, guardLoader, unreadHtml, emptyState } from "../src/pages.ts";

test("T169 P6 — the error banner carries a Retry button", () => {
  const html = errorBannerHtml("rate limit exceeded");
  expect(html).toContain('class="banner-retry"');
  expect(html).toContain("Retry");
});

test("T169 P6 — a 429 with retry-after auto-retries the loader once", async () => {
  let attempts = 0;
  const loader = guardLoader(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new ApiError(429, "rate limit exceeded", 30);
    }
    return "<section>loaded</section>";
  });
  const html = await loader({});
  expect(attempts).toBe(2);
  expect(html).toContain("loaded");
});

test("T169 P6 — a non-429 failure still renders the banner (no retry loop)", async () => {
  let attempts = 0;
  const loader = guardLoader(async () => {
    attempts += 1;
    throw new ApiError(500, "boom");
  });
  const html = await loader({});
  expect(attempts).toBe(1);
  expect(html).toContain("Retry");
});

test("T169 P6 — list pages have human empty states", () => {
  expect(unreadHtml([], undefined)).toContain("Nothing unread");
  expect(emptyState("No recent activity")).toContain("No recent activity");
});
