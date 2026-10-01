import { pathToFileURL } from "node:url";

const packages = ["bridge", "cli", "mcp-server", "shared", "web-ui"];
let failures = 0;
for (const pkg of packages) {
  const url = pathToFileURL(`packages/${pkg}/dist/index.mjs`).href;
  try {
    const mod = await import(url);
    if (mod.version !== "0.0.0") throw new Error(`bad version: ${String(mod.version)}`);
    if (mod.name !== `@wa-mcp/${pkg}`) throw new Error(`bad name: ${String(mod.name)}`);
    console.log(`ok ${pkg}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${pkg}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failures === 0 ? 0 : 1);
