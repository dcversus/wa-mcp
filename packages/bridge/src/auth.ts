import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthenticationCreds } from "baileys";

export interface AuthStore {
  loadCreds(): Promise<AuthenticationCreds | null>;
  saveCreds(creds: AuthenticationCreds): Promise<void>;
}

const CREDS_FILE = "creds.json";

export function openAuthStore(dir: string): AuthStore {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, CREDS_FILE);
  return {
    async loadCreds() {
      try {
        if (!existsSync(file)) {
          return null;
        }
        const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return null;
        }
        return parsed as AuthenticationCreds;
      } catch {
        return null;
      }
    },
    async saveCreds(creds) {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(creds), { mode: 0o600 });
      await rename(tmp, file);
      chmodSync(file, 0o600);
    },
  };
}

export interface OwnIdentity {
  pn: string | null;
  name: string | null;
}

export function readOwnIdentity(dir: string): OwnIdentity {
  const file = join(dir, CREDS_FILE);
  if (!existsSync(file)) {
    return { pn: null, name: null };
  }
  try {
    const creds = JSON.parse(readFileSync(file, "utf8")) as {
      me?: { id?: string; name?: string };
    };
    const id = creds.me?.id ?? null;
    const pn = id !== null ? (id.split("@")[0]?.replace(/:\d+$/, "") ?? null) : null;
    return { pn, name: creds.me?.name ?? null };
  } catch {
    return { pn: null, name: null };
  }
}
