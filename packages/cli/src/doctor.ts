import { existsSync, statSync, writeFileSync } from "node:fs";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  home: string;
  dataDir: string;
  bridgeUrl: string;
  fetchFn?: typeof fetch;
  minNodeMajor: number;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node version",
    ok: nodeMajor >= options.minNodeMajor,
    detail: `node ${process.versions.node} (required >=${options.minNodeMajor})`,
  });
  let writable = false;
  try {
    const probe = `${options.dataDir}/.doctor-probe`;
    writeFileSync(probe, "x");
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({ name: "data dir writable", ok: writable, detail: options.dataDir });
  const tokenPath = `${options.dataDir}/token`;
  let tokenOk = false;
  let tokenDetail = "missing";
  if (existsSync(tokenPath)) {
    const mode = statSync(tokenPath).mode & 0o777;
    if (process.platform === "win32") {
      tokenOk = true;
      tokenDetail = "present (posix perms not checked on windows)";
    } else if (mode === 0o600) {
      tokenOk = true;
      tokenDetail = "present, mode 0600";
    } else {
      tokenDetail = `present but mode ${mode.toString(8)} (expected 600)`;
    }
  }
  checks.push({ name: "bridge token", ok: tokenOk, detail: tokenDetail });
  let healthOk = false;
  let healthDetail = "unreachable";
  try {
    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(`${options.bridgeUrl}/health`);
    healthOk = response.ok;
    healthDetail = response.ok
      ? `reachable at ${options.bridgeUrl}`
      : `returned ${response.status}`;
  } catch (err) {
    healthDetail = `unreachable at ${options.bridgeUrl} — is the daemon running? (${
      err instanceof Error ? err.message : String(err)
    })`;
  }
  checks.push({ name: "bridge health", ok: healthOk, detail: healthDetail });
  return { ok: checks.every((check) => check.ok), checks };
}
