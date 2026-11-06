import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
/** the longest lifetime Apple platforms accept for a TLS server certificate */
const VALID_DAYS = 825;
const RENEW_WITHIN_DAYS = 30;

export interface LocalCert {
  cert: string;
  key: string;
}

export function localCertPaths(dataDir: string): { certPath: string; keyPath: string } {
  const dir = join(dataDir, "tls");
  return { certPath: join(dir, "cert.pem"), keyPath: join(dir, "key.pem") };
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  if (body.length < 0x80) {
    return Buffer.concat([Buffer.from([tag, body.length]), body]);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const significant = length.subarray(length.findIndex((byte) => byte !== 0));
  return Buffer.concat([Buffer.from([tag, 0x80 | significant.length]), significant, body]);
}

const seq = (...parts: Buffer[]) => der(0x30, ...parts);
const oid = (hex: string) => der(0x06, Buffer.from(hex, "hex"));
const octets = (body: Buffer) => der(0x04, body);
const CRITICAL = der(0x01, Buffer.from([0xff]));

const OID_CN = "550403";
const OID_ECDSA_SHA256 = "2a8648ce3d040302";
const OID_BASIC_CONSTRAINTS = "551d13";
const OID_KEY_USAGE = "551d0f";
const OID_EXT_KEY_USAGE = "551d25";
const OID_SUBJECT_ALT_NAME = "551d11";
const OID_SERVER_AUTH = "2b06010505070301";

function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, "").slice(2, 14);
  return der(0x17, Buffer.from(`${text}Z`, "ascii"));
}

/** Node can read X.509 but not write it, and the bridge core takes no runtime
 * dependency (ADR 0002), so the certificate is assembled here. It is a leaf
 * (CA:FALSE) that is its own trust anchor: there is no CA key, so trusting it
 * can never authenticate anything but this one certificate (ADR 0013). */
function issueCertificate(now: Date): LocalCert {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const signatureAlgorithm = seq(oid(OID_ECDSA_SHA256));
  const name = seq(
    der(0x31, seq(oid(OID_CN), der(0x0c, Buffer.from("wa-mcp local daemon", "utf8")))),
  );
  const altNames = seq(
    der(0x82, Buffer.from("localhost", "ascii")),
    der(0x87, Buffer.from([127, 0, 0, 1])),
    der(0x87, Buffer.from([...Array<number>(15).fill(0), 1])),
  );
  const extensions = seq(
    seq(oid(OID_BASIC_CONSTRAINTS), CRITICAL, octets(seq())),
    // digitalSignature only: the bit string has 7 unused bits
    seq(oid(OID_KEY_USAGE), CRITICAL, octets(der(0x03, Buffer.from([0x07, 0x80])))),
    seq(oid(OID_EXT_KEY_USAGE), octets(seq(oid(OID_SERVER_AUTH)))),
    seq(oid(OID_SUBJECT_ALT_NAME), octets(altNames)),
  );
  const serial = randomBytes(16);
  // a positive INTEGER: the top bit stays clear, the next set keeps it minimal
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40;
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    signatureAlgorithm,
    name,
    // a day of slack for a clock that moved backwards
    seq(
      utcTime(new Date(now.getTime() - DAY_MS)),
      utcTime(new Date(now.getTime() + VALID_DAYS * DAY_MS)),
    ),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, extensions),
  );
  const signature = sign("sha256", tbs, privateKey);
  // BIT STRING: a leading byte counts the unused bits
  const certificate = seq(tbs, signatureAlgorithm, der(0x03, Buffer.from([0]), signature));
  const lines = certificate.toString("base64").match(/.{1,64}/g) ?? [];
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function readUsable(certPath: string, keyPath: string, now: Date): LocalCert | null {
  try {
    const cert = readFileSync(certPath, "utf8");
    const key = readFileSync(keyPath, "utf8");
    const x509 = new X509Certificate(cert);
    const renewAt = new Date(x509.validTo).getTime() - RENEW_WITHIN_DAYS * DAY_MS;
    if (now.getTime() >= renewAt || !x509.checkPrivateKey(createPrivateKey(key))) {
      return null;
    }
    return { cert, key };
  } catch {
    return null;
  }
}

function writeAtomic(path: string, text: string, mode: number): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
}

/** The daemon's certificate, created on first use and replaced at the same
 * path when it is broken or within 30 days of expiry, so a host that was told
 * to trust the path keeps working (it re-reads the file when it starts). */
export function ensureLocalCert(dataDir: string, now: Date = new Date()): LocalCert {
  const { certPath, keyPath } = localCertPaths(dataDir);
  const existing = readUsable(certPath, keyPath, now);
  if (existing !== null) {
    return existing;
  }
  mkdirSync(join(dataDir, "tls"), { recursive: true, mode: 0o700 });
  const issued = issueCertificate(now);
  writeAtomic(keyPath, issued.key, 0o600);
  writeAtomic(certPath, issued.cert, 0o644);
  return issued;
}
