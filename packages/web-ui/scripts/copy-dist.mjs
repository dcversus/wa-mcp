import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "dist");
const target = join(here, "..", "..", "bridge", "dist", "web");
if (!existsSync(join(source, "index.html"))) {
  console.error(
    `web-ui/dist/index.html is missing — run \`pnpm --filter @wa-mcp/web-ui build\` first (refusing to copy an empty UI)`,
  );
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(
  `web ui copied to ${target} (${statSync(join(source, "index.html")).size} bytes index.html)`,
);
