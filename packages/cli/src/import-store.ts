import { join } from "node:path";
import { importLayout, type SourceLayout } from "@wa-mcp/bridge/src/store/import.ts";
import { openStore } from "@wa-mcp/bridge/src/store/schema.ts";

export interface ImportOptions {
  from: SourceLayout;
  path: string;
  dataDir: string;
  dryRun?: boolean;
}

/** T83: `wa-mcp import` — map a foreign-layout store into ours. */
export function runImport(options: ImportOptions): { chats: number; messages: number } {
  const store = openStore(join(options.dataDir, "store"));
  try {
    const report = importLayout(store, options.from, options.path, {
      dryRun: options.dryRun === true,
    });
    const mode = report.dryRun ? "dry-run" : "imported";
    console.log(
      `import ${mode}: ${report.chats} chats, ${report.messages} messages from ${options.from} (${options.path})`,
    );
    return { chats: report.chats, messages: report.messages };
  } finally {
    store.close();
  }
}
