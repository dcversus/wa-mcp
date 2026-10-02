import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import type { AuthenticationCreds } from "baileys";
import { openAuthStore } from "../src/auth.ts";

const POSIX_PERMS = process.platform !== "win32";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "wa-mcp-auth-"));
}

const sampleCreds = {
  noiseKey: { type: "Buffer", data: [1, 2, 3] },
  signedIdentityKey: { type: "Buffer", data: [4, 5, 6] },
  registrationId: 42,
} as unknown as AuthenticationCreds;

test.skipIf(!POSIX_PERMS)("openAuthStore enforces 0700 on an existing loose directory", () => {
  const dir = freshDir();
  chmodSync(dir, 0o777);
  openAuthStore(dir);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
});

test.skipIf(!POSIX_PERMS)("openAuthStore creates a missing directory with 0700", () => {
  const parent = freshDir();
  const dir = join(parent, "nested", "auth");
  openAuthStore(dir);
  expect(existsSync(dir)).toBe(true);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
});

test("loadCreds returns null when no creds file exists", async () => {
  const store = openAuthStore(freshDir());
  expect(await store.loadCreds()).toBeNull();
});

test(
  "saveCreds round-trips and leaves the file at 0600 on posix",
  { skip: !POSIX_PERMS },
  async () => {
    const dir = freshDir();
    const store = openAuthStore(dir);
    await store.saveCreds(sampleCreds);
    const file = join(dir, "creds.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await store.loadCreds()).toEqual(sampleCreds);
  },
);

test(
  "saveCreds keeps 0600 after overwriting an existing file",
  { skip: !POSIX_PERMS },
  async () => {
    const dir = freshDir();
    const store = openAuthStore(dir);
    await store.saveCreds(sampleCreds);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "creds.json");
    writeFileSync(file, "{}", { mode: 0o666 });
    await store.saveCreds(sampleCreds);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  },
);

test("corrupt creds JSON returns null instead of throwing", async () => {
  const dir = freshDir();
  const store = openAuthStore(dir);
  writeFileSync(join(dir, "creds.json"), "{oops");
  expect(await store.loadCreds()).toBeNull();
});

test("non-object creds JSON returns null", async () => {
  const dir = freshDir();
  const store = openAuthStore(dir);
  writeFileSync(join(dir, "creds.json"), "42");
  expect(await store.loadCreds()).toBeNull();
});
