import { expect, test } from "vite-plus/test";
import { renderFrame, type AppDom } from "../src/app.ts";

const SKELETON = '<div class="skeleton">loading…</div>';

test("refreshing the page on screen never blanks it; moving to another page shows loading", async () => {
  const history: string[] = [];
  let hash = "#/connection";
  const dom: AppDom = {
    getHash: () => hash,
    setHash: () => {},
    setNav: () => {},
    setApp: (html) => history.push(html),
    setTitle: () => {},
  };
  const loaders = {
    connection: async () => "<p>connection</p>",
    contacts: async () => "<p>contacts</p>",
  };

  await renderFrame({ dom, loaders });
  expect(history).toEqual([SKELETON, "<p>connection</p>"]);

  history.length = 0;
  await renderFrame({ dom, loaders });
  expect(history).toEqual(["<p>connection</p>"]);

  history.length = 0;
  hash = "#/contacts";
  await renderFrame({ dom, loaders });
  expect(history).toEqual([SKELETON, "<p>contacts</p>"]);

  history.length = 0;
  hash = "#/connection";
  await renderFrame({ dom, loaders });
  expect(history).toEqual([SKELETON, "<p>connection</p>"]);
});
