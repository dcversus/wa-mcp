import { mkdirSync } from "node:fs";
import { parse } from "node:path";
import process from "node:process";

// CI windows runners have no /tmp; several tests use "/tmp/..." literals.
// Create the root-level tmp once per worker so those paths resolve.
export function setup() {
  if (process.platform === "win32") {
    try {
      mkdirSync(parse(process.cwd()).root + "tmp", { recursive: true });
    } catch {
      // best effort — tests will surface the real cause if this fails
    }
  }
}
