import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const gettingStarted = readFileSync(
  join(import.meta.dirname, "../../../docs/getting-started/index.md"),
  "utf8",
);

test("the getting-started docs cover both pairing methods honestly", () => {
  expect(gettingStarted).toContain("wa-mcp pair --code");
  expect(gettingStarted).toContain("Link with phone number instead");
  expect(gettingStarted).toContain("wa-mcp start");
  expect(gettingStarted).toContain("#/pairing");
});

test("the documented --code example matches the flag the CLI actually parses", () => {
  const binSource = readFileSync(join(import.meta.dirname, "../src/bin.ts"), "utf8");
  expect(binSource).toContain('command === "pair"');
  expect(binSource).toContain("codePhone: flags.code");
});

test("docs do not promise a code path the web UI lacks", () => {
  const pairingPage = readFileSync(
    join(import.meta.dirname, "../../web-ui/src/pages-pairing.ts"),
    "utf8",
  );
  expect(pairingPage).toContain('id="phone-form"');
  expect(gettingStarted).toContain("phone-number form");
});
