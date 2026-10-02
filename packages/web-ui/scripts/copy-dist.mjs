import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "dist");
const target = join(here, "..", "..", "bridge", "dist", "web");
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`web ui copied to ${target}`);
