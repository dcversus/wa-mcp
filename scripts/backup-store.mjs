/** T80 line62: `vp run backup-store [--data-dir X] [--backups-dir Y] [--retention N]`
 * Copies store.db (+WAL/SHM) and media/ into backups/<timestamp>/ and prunes
 * beyond retention (default 7, env BACKUP_RETENTION). */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { runBackup } from "../packages/bridge/src/store/backup.ts";

const { values } = parseArgs({
  options: {
    "data-dir": { type: "string" },
    "backups-dir": { type: "string" },
    retention: { type: "string", default: process.env.BACKUP_RETENTION ?? "7" },
  },
});
const home = homedir();
const dataDir = resolve((values["data-dir"] ?? `${home}/.wa-mcp`).replace(/^~/, home));
const backupsDir = resolve((values["backups-dir"] ?? `${dataDir}/backups`).replace(/^~/, home));
const target = runBackup(dataDir, backupsDir, Number(values.retention));
console.log(`backup-store OK: ${target} (retention ${values.retention})`);
