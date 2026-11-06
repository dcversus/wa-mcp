import { execFileSync } from "node:child_process";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer, type TLSSocket } from "node:tls";
import { afterEach, expect, test } from "vite-plus/test";
import { ensureLocalCert, localCertPaths } from "../src/tls-cert.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-tls-"));
  dirs.push(dir);
  return dir;
}
const DAY = 24 * 60 * 60 * 1000;

test("the certificate names only this machine's loopback and matches its key", () => {
  const { cert, key } = ensureLocalCert(dataDir());
  const x509 = new X509Certificate(cert);
  expect(x509.ca).toBe(false);
  expect(x509.checkHost("localhost")).toBe("localhost");
  expect(x509.checkIP("127.0.0.1")).toBe("127.0.0.1");
  expect(x509.checkIP("::1")).toBeDefined();
  expect(x509.checkHost("example.com")).toBeUndefined();
  expect(x509.checkIP("10.0.0.1")).toBeUndefined();
  expect(x509.checkPrivateKey(createPrivateKey(key))).toBe(true);
  expect(x509.verify(x509.publicKey)).toBe(true);
  expect(x509.keyUsage).toContain("1.3.6.1.5.5.7.3.1");
});

test.skipIf(process.platform === "win32")("the private key is readable only by the owner", () => {
  const dir = dataDir();
  ensureLocalCert(dir);
  expect(statSync(localCertPaths(dir).keyPath).mode & 0o777).toBe(0o600);
});

test("openssl accepts the certificate as its own trust anchor for loopback", () => {
  const dir = dataDir();
  ensureLocalCert(dir);
  const { certPath } = localCertPaths(dir);
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
  } catch {
    return; // not installed on this runner
  }
  const out = execFileSync(
    "openssl",
    ["verify", "-CAfile", certPath, "-verify_ip", "127.0.0.1", certPath],
    { encoding: "utf8" },
  );
  expect(out).toContain("OK");
});

function handshake(cert: string, key: string, ca: string | undefined): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer({ cert, key }, (socket) => socket.end());
    server.on("tlsClientError", () => {});
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const client: TLSSocket = connect({
        host: "127.0.0.1",
        port,
        ...(ca === undefined ? {} : { ca }),
      });
      const done = (result: string) => {
        client.destroy();
        server.close(() => resolve(result));
      };
      client.once("secureConnect", () => done(client.authorized ? "trusted" : "untrusted"));
      client.once("error", (err: NodeJS.ErrnoException) => done(err.code ?? err.message));
    });
  });
}

test("a real TLS client trusts it when told to, and only then", async () => {
  const { cert, key } = ensureLocalCert(dataDir());
  expect(await handshake(cert, key, cert)).toBe("trusted");
  expect(await handshake(cert, key, undefined)).not.toBe("trusted");
});

test("a second call reuses the same certificate, so a trusted path stays valid", () => {
  const dir = dataDir();
  expect(ensureLocalCert(dir).cert).toBe(ensureLocalCert(dir).cert);
});

test("a certificate about to expire is replaced at the same path", () => {
  const dir = dataDir();
  const first = ensureLocalCert(dir);
  const notAfter = new Date(new X509Certificate(first.cert).validTo).getTime();
  const later = new Date(notAfter - 10 * DAY);
  const renewed = ensureLocalCert(dir, later);
  expect(renewed.cert).not.toBe(first.cert);
  expect(readFileSync(localCertPaths(dir).certPath, "utf8")).toBe(renewed.cert);
});

test("broken or mismatched files are replaced instead of crashing the daemon", () => {
  const dir = dataDir();
  ensureLocalCert(dir);
  const { certPath, keyPath } = localCertPaths(dir);
  writeFileSync(certPath, "not a certificate");
  const repaired = ensureLocalCert(dir);
  expect(new X509Certificate(repaired.cert).ca).toBe(false);

  const other = ensureLocalCert(dataDir());
  writeFileSync(keyPath, other.key);
  const rematched = ensureLocalCert(dir);
  expect(new X509Certificate(rematched.cert).checkPrivateKey(createPrivateKey(rematched.key))).toBe(
    true,
  );
  expect(existsSync(certPath)).toBe(true);
});
