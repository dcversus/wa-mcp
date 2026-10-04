import { statfsSync } from "node:fs";

export interface AutoDownloadRules {
  enabled: boolean;
  skipStatus: boolean;
  minFreeBytes: number;
  allowedExtensions: string[];
}

/** T89 line135: WA_AUTO_DOWNLOAD default-on; status media never auto-saved;
 * skip when free disk is under the threshold (WA_MIN_FREE_MB, default 500). */
export function autoDownloadRules(env: NodeJS.ProcessEnv = process.env): AutoDownloadRules {
  const on = env.WA_AUTO_DOWNLOAD;
  return {
    enabled: on !== "0" && on !== "false",
    skipStatus: env.WA_AUTO_DOWNLOAD_SKIP_STATUS !== "false",
    minFreeBytes: Number(env.WA_MIN_FREE_MB ?? 500) * 1024 * 1024,
    allowedExtensions: (env.WA_ALLOWED_EXTENSIONS ?? "")
      .split(",")
      .map((ext) => ext.trim().toLowerCase().replace(/^\./, ""))
      .filter((ext) => ext.length > 0),
  };
}

export function shouldAutoDownload(
  chatJid: string,
  dir: string,
  rules: AutoDownloadRules,
  fileName?: string,
): { ok: boolean; reason?: string } {
  if (!rules.enabled) {
    return { ok: false, reason: "auto-download disabled by WA_AUTO_DOWNLOAD" };
  }
  if (rules.skipStatus && chatJid.includes("status@broadcast")) {
    return { ok: false, reason: "status media is never auto-saved" };
  }
  if (rules.allowedExtensions.length > 0 && fileName !== undefined) {
    const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
    if (!rules.allowedExtensions.includes(ext)) {
      return {
        ok: false,
        reason: `extension ${ext || "(none)"} not in WA_ALLOWED_EXTENSIONS (${rules.allowedExtensions.join(",")})`,
      };
    }
  }
  try {
    const stats = statfsSync(dir);
    const free = stats.bavail * stats.bsize;
    if (free < rules.minFreeBytes) {
      return { ok: false, reason: `low disk: ${Math.floor(free / 1024 / 1024)}MB free` };
    }
  } catch {
    // unreadable fs — default to allowing the download
  }
  return { ok: true };
}
