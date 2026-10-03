/** One-time repair (T58): merge LID-keyed chats into their canonical PN chats
 * using the engine's reverse-mapping files in the auth dir. Transactional per
 * chat; chats without a reverse mapping are left untouched. The live store is
 * NOT touched by this repo — the owner runs this against the data dir. */
import { openStore } from "../packages/bridge/src/store/schema.ts";
import { mergeLidChats } from "../packages/bridge/src/store/merge-lid-chats.ts";
import { join } from "node:path";

const dataDir = process.argv[2]?.startsWith("--data-dir") ? process.argv[3] : process.argv[2];
if (dataDir === undefined || dataDir.length === 0) {
  console.error("usage: vp run merge-lid-chats --data-dir <path> (default ~/.wa-mcp)");
  process.exit(1);
}
const authDir = join(dataDir, "auth");
const store = openStore(join(dataDir, "store"));
const result = mergeLidChats(store, authDir);
console.log(
  `merge-lid-chats: merged ${result.mergedChats} chat(s), moved ${result.movedMessages} message(s), skipped ${result.skippedMessages} duplicate id(s)`,
);
store.close();
