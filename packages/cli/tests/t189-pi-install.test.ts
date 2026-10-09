import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import {
  installPiExtension,
  piExtensionPlan,
  piSettingsPath,
  uninstallPiExtension,
} from "../src/pi-extension.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(settings?: unknown): {
  home: string;
  dataDir: string;
  sourceDir: string;
  settingsPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "t189-pi-install-"));
  roots.push(root);
  const home = join(root, "home");
  const dataDir = join(home, ".wa-mcp");
  const sourceDir = join(root, "pkg", "dist");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "index.mjs"), "export default function () {}\n");
  const settingsPath = piSettingsPath(home);
  if (settings !== undefined) {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { home, dataDir, sourceDir, settingsPath };
}

const EXISTING = {
  packages: ["../../.nvm/versions/node/v22.16.0/lib/node_modules/pi-mcp-extension"],
  defaultModel: "glm-4.7",
};

let tick = 0;
const now = (): string => `T${(tick += 1)}`;

function backups(settingsPath: string): string[] {
  const dir = join(settingsPath, "..");
  return readdirSync(dir).filter((name) => name.startsWith("settings.json.bak-"));
}

test("T189 — install copies a self-contained dist and appends its absolute path to pi packages", () => {
  const { home, dataDir, sourceDir, settingsPath } = fixture(EXISTING);
  const result = installPiExtension({ home, dataDir, sourceDir, now });
  const distDir = join(dataDir, "pi-extension-dist");
  expect(result.distDir).toBe(distDir);
  expect(result.changed).toBe(true);
  expect(readFileSync(join(distDir, "index.mjs"), "utf8")).toContain("export default");
  const manifest = JSON.parse(readFileSync(join(distDir, "package.json"), "utf8"));
  expect(manifest.pi.extensions).toEqual(["./index.mjs"]);
  expect(manifest.type).toBe("module");
  expect(manifest.keywords).toEqual(expect.arrayContaining(["pi-package", "pi-extension"]));
  expect(manifest.dependencies).toBeUndefined();
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  expect(settings.packages).toEqual([...EXISTING.packages, distDir]);
  expect(settings.defaultModel).toBe("glm-4.7");
  expect(result.backupPath).toBeDefined();
  expect(JSON.parse(readFileSync(result.backupPath ?? "", "utf8"))).toEqual(EXISTING);
});

test("T189 — re-running install is idempotent: one entry, no extra backup", () => {
  const { home, dataDir, sourceDir, settingsPath } = fixture(EXISTING);
  installPiExtension({ home, dataDir, sourceDir, now });
  const after = readFileSync(settingsPath, "utf8");
  const again = installPiExtension({ home, dataDir, sourceDir, now });
  expect(again.changed).toBe(false);
  expect(again.backupPath).toBeUndefined();
  expect(readFileSync(settingsPath, "utf8")).toBe(after);
  expect(backups(settingsPath)).toHaveLength(1);
});

test("T189 — install creates settings.json when pi has none yet", () => {
  const { home, dataDir, sourceDir, settingsPath } = fixture();
  const result = installPiExtension({ home, dataDir, sourceDir, now });
  expect(result.backupPath).toBeUndefined();
  expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
    packages: [join(dataDir, "pi-extension-dist")],
  });
});

test("T189 — install refuses to rewrite a settings.json that is not valid JSON", () => {
  const { home, dataDir, sourceDir, settingsPath } = fixture();
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(settingsPath, "{ broken");
  expect(() => installPiExtension({ home, dataDir, sourceDir, now })).toThrow(/not valid JSON/);
  expect(readFileSync(settingsPath, "utf8")).toBe("{ broken");
});

test("T189 — install fails loudly when the extension build is missing", () => {
  const { home, dataDir } = fixture(EXISTING);
  expect(() =>
    installPiExtension({ home, dataDir, sourceDir: join(home, "nowhere"), now }),
  ).toThrow(/pi extension build not found/);
});

test("T189 — uninstall removes only our entry and the dist copy, with a backup", () => {
  const { home, dataDir, sourceDir, settingsPath } = fixture(EXISTING);
  installPiExtension({ home, dataDir, sourceDir, now });
  const result = uninstallPiExtension({ home, dataDir, now });
  expect(result.changed).toBe(true);
  expect(result.backupPath).toBeDefined();
  expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(EXISTING);
  expect(existsSync(join(dataDir, "pi-extension-dist"))).toBe(false);
  const again = uninstallPiExtension({ home, dataDir, now });
  expect(again.changed).toBe(false);
  expect(again.backupPath).toBeUndefined();
});

test("T189 — uninstall without pi settings is a no-op", () => {
  const { home, dataDir } = fixture();
  expect(uninstallPiExtension({ home, dataDir, now })).toEqual({
    changed: false,
    settingsPath: piSettingsPath(home),
    distDir: join(dataDir, "pi-extension-dist"),
  });
});

test("T189 — the dry-run plan names the dist copy and the settings entry, writing nothing", () => {
  const { home, dataDir, sourceDir, settingsPath } = fixture(EXISTING);
  const lines = piExtensionPlan({ home, dataDir, sourceDir });
  expect(lines.join("\n")).toContain(`pi extension: copy ${sourceDir}`);
  expect(lines.join("\n")).toContain(join(dataDir, "pi-extension-dist"));
  expect(lines.join("\n")).toContain(`add to ${settingsPath} packages`);
  expect(existsSync(join(dataDir, "pi-extension-dist"))).toBe(false);
  expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual(EXISTING);
  installPiExtension({ home, dataDir, sourceDir, now });
  expect(piExtensionPlan({ home, dataDir, sourceDir }).join("\n")).toContain("already listed");
});
