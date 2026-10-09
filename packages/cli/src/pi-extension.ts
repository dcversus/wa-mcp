import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface PiExtensionOptions {
  home: string;
  dataDir: string;
  sourceDir: string;
  now?: () => string;
}

export interface PiExtensionResult {
  changed: boolean;
  settingsPath: string;
  distDir: string;
  backupPath?: string;
}

interface PiSettings {
  packages?: unknown[];
  [key: string]: unknown;
}

const ENTRY = "index.mjs";

const MANIFEST = {
  name: "wa-mcp-pi-extension",
  private: true,
  type: "module",
  description: "wa-mcp: inject WhatsApp subscription events into the live pi session",
  keywords: ["pi-package", "pi-extension", "whatsapp", "wa-mcp"],
  pi: { extensions: [`./${ENTRY}`] },
};

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

export function piSettingsPath(home: string): string {
  return join(home, ".pi", "agent", "settings.json");
}

export function piExtensionDistDir(dataDir: string): string {
  return join(dataDir, "pi-extension-dist");
}

function readSettings(settingsPath: string): PiSettings | null {
  if (!existsSync(settingsPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as PiSettings;
  } catch {
    throw new Error(`refusing: ${settingsPath} is not valid JSON`);
  }
}

function packagesOf(settings: PiSettings | null): unknown[] {
  return Array.isArray(settings?.packages) ? settings.packages : [];
}

function writeSettings(
  settingsPath: string,
  settings: PiSettings,
  now: () => string,
): string | undefined {
  let backupPath: string | undefined;
  if (existsSync(settingsPath)) {
    backupPath = `${settingsPath}.bak-${now()}`;
    renameSync(settingsPath, backupPath);
  } else {
    mkdirSync(dirname(settingsPath), { recursive: true });
  }
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return backupPath;
}

export function installPiExtension(options: PiExtensionOptions): PiExtensionResult {
  const now = options.now ?? stamp;
  const source = join(options.sourceDir, ENTRY);
  if (!existsSync(source)) {
    throw new Error(`pi extension build not found at ${source} — run pnpm -r build`);
  }
  const settingsPath = piSettingsPath(options.home);
  const settings = readSettings(settingsPath);
  const distDir = piExtensionDistDir(options.dataDir);
  mkdirSync(distDir, { recursive: true });
  copyFileSync(source, join(distDir, ENTRY));
  writeFileSync(join(distDir, "package.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  const packages = packagesOf(settings);
  if (packages.includes(distDir)) {
    return { changed: false, settingsPath, distDir };
  }
  const backupPath = writeSettings(
    settingsPath,
    { ...settings, packages: [...packages, distDir] },
    now,
  );
  return {
    changed: true,
    settingsPath,
    distDir,
    ...(backupPath === undefined ? {} : { backupPath }),
  };
}

export function uninstallPiExtension(
  options: Omit<PiExtensionOptions, "sourceDir">,
): PiExtensionResult {
  const now = options.now ?? stamp;
  const settingsPath = piSettingsPath(options.home);
  const distDir = piExtensionDistDir(options.dataDir);
  const settings = readSettings(settingsPath);
  rmSync(distDir, { recursive: true, force: true });
  const packages = packagesOf(settings);
  if (settings === null || !packages.includes(distDir)) {
    return { changed: false, settingsPath, distDir };
  }
  const backupPath = writeSettings(
    settingsPath,
    { ...settings, packages: packages.filter((entry) => entry !== distDir) },
    now,
  );
  return {
    changed: true,
    settingsPath,
    distDir,
    ...(backupPath === undefined ? {} : { backupPath }),
  };
}

export function piExtensionPlan(options: Omit<PiExtensionOptions, "now">): string[] {
  const settingsPath = piSettingsPath(options.home);
  const distDir = piExtensionDistDir(options.dataDir);
  let listed = false;
  try {
    listed = packagesOf(readSettings(settingsPath)).includes(distDir);
  } catch (err) {
    return [
      `pi extension: copy ${options.sourceDir} → ${distDir}`,
      `pi extension: ${err instanceof Error ? err.message : String(err)}`,
    ];
  }
  return [
    `pi extension: copy ${options.sourceDir} → ${distDir}`,
    listed
      ? `pi extension: ${distDir} already listed in ${settingsPath} packages`
      : `pi extension: add to ${settingsPath} packages: ${distDir} (backup first)`,
  ];
}
