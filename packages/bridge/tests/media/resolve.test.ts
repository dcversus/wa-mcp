import { mkdtempSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { MediaError, resolveMedia, saveOutboundMedia } from "../../src/media/resolve.ts";
import { openStore, type Store } from "../../src/store/schema.ts";

const POSIX_PERMS = process.platform !== "win32";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
/** T73 H3: the SSRF guard resolves names — stub DNS with a public IP */
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const JPEG = Buffer.from("ffd8ffe000104a464946", "hex");
const MP3 = Buffer.concat([Buffer.from("494433", "hex"), Buffer.alloc(64, 1)]);
const OGG = Buffer.concat([Buffer.from("4f676753", "hex"), Buffer.alloc(32, 2)]);
const ZIP = Buffer.from("504b030414000000", "hex");
const PDF = Buffer.concat([Buffer.from("255044462d", "hex"), Buffer.alloc(16, 3)]);
const MP4 = Buffer.concat([
  Buffer.alloc(4, 0),
  Buffer.from("66747970", "hex"),
  Buffer.alloc(32, 4),
]);
const WEBP = Buffer.concat([
  Buffer.from("52494646", "hex"),
  Buffer.alloc(4, 0),
  Buffer.from("57454250", "hex"),
]);

const dirs: string[] = [];
const stores: Store[] = [];

function freshMediaDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-media-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

test("base64 input decodes and sniffs png", async () => {
  const resolved = await resolveMedia(
    { base64: PNG.toString("base64") },
    { mediaDir: freshMediaDir() },
  );
  expect(resolved.buffer.equals(PNG)).toBe(true);
  expect(resolved.mimeType).toBe("image/png");
  expect(resolved.fileName).toBe("file.png");
});

test("magic-byte sniffing covers the supported table", async () => {
  const dir = freshMediaDir();
  const cases: Array<[Buffer, string]> = [
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [WEBP, "image/webp"],
    [MP4, "video/mp4"],
    [MP3, "audio/mpeg"],
    [OGG, "audio/ogg"],
    [PDF, "application/pdf"],
    [ZIP, "application/zip"],
    [Buffer.alloc(16, 9), "application/octet-stream"],
  ];
  for (const [bytes, expected] of cases) {
    const resolved = await resolveMedia({ base64: bytes.toString("base64") }, { mediaDir: dir });
    expect(resolved.mimeType, expected).toBe(expected);
  }
});

test("a provided file name wins over the derived one", async () => {
  const resolved = await resolveMedia(
    { base64: PNG.toString("base64"), fileName: "photo.png" },
    { mediaDir: freshMediaDir() },
  );
  expect(resolved.fileName).toBe("photo.png");
});

test("path input reads inside the media dir", async () => {
  const dir = freshMediaDir();
  writeFileSync(join(dir, "cat.jpg"), JPEG);
  const resolved = await resolveMedia({ path: "cat.jpg" }, { mediaDir: dir });
  expect(resolved.buffer.equals(JPEG)).toBe(true);
  expect(resolved.mimeType).toBe("image/jpeg");
});

test("path traversal outside the media dir is forbidden", async () => {
  const dir = freshMediaDir();
  const outside = mkdtempSync(join(tmpdir(), "wa-mcp-outside-"));
  dirs.push(outside);
  writeFileSync(join(outside, "secret.txt"), "secret");
  await expect(resolveMedia({ path: "../secret.txt" }, { mediaDir: dir })).rejects.toMatchObject({
    code: "PATH_FORBIDDEN",
  });
  await expect(
    resolveMedia({ path: join(outside, "secret.txt") }, { mediaDir: dir }),
  ).rejects.toMatchObject({
    code: "PATH_FORBIDDEN",
  });
});

test("a symlink escaping the media dir is resolved and forbidden", async () => {
  const dir = freshMediaDir();
  const outside = mkdtempSync(join(tmpdir(), "wa-mcp-outside-"));
  dirs.push(outside);
  writeFileSync(join(outside, "secret.txt"), "secret");
  symlinkSync(join(outside, "secret.txt"), join(dir, "escape.jpg"));
  await expect(resolveMedia({ path: "escape.jpg" }, { mediaDir: dir })).rejects.toMatchObject({
    code: "PATH_FORBIDDEN",
  });
});

test("a missing file reports not found", async () => {
  const dir = freshMediaDir();
  await expect(resolveMedia({ path: "nope.jpg" }, { mediaDir: dir })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("url input fetches, sniffs and caps size", async () => {
  const dir = freshMediaDir();
  const big = Buffer.alloc(21_000_000, 1);
  const fetchMock = (async (input: string | URL) => {
    const url = String(input);
    if (url === "https://cdn.example/big.bin") {
      return new Response(big, {
        headers: { "content-length": String(big.length) },
      });
    }
    if (url === "https://cdn.example/cat.jpg") {
      return new Response(JPEG);
    }
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const ok = await resolveMedia(
    { url: "https://cdn.example/cat.jpg" },
    { mediaDir: dir, fetchFn: fetchMock, lookupFn: publicLookup },
  );
  expect(ok.mimeType).toBe("image/jpeg");
  expect(ok.fileName).toBe("cat.jpg");
  await expect(
    resolveMedia(
      { url: "https://cdn.example/big.bin" },
      { mediaDir: dir, fetchFn: fetchMock, lookupFn: publicLookup },
    ),
  ).rejects.toMatchObject({ code: "TOO_LARGE" });
  await expect(
    resolveMedia(
      { url: "https://cdn.example/down" },
      { mediaDir: dir, fetchFn: fetchMock, lookupFn: publicLookup },
    ),
  ).rejects.toMatchObject({ code: "FETCH_FAILED" });
});

test.skipIf(!POSIX_PERMS)(
  "saveOutboundMedia writes 0644 under a 0700 dir and links the row",
  async () => {
    const dir = freshMediaDir();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-media-store-")));
    stores.push(store);
    storeMessageRow(store);
    const path = await saveOutboundMedia(store, dir, "MSGID1", PNG, "image/png");
    expect(path.endsWith("MSGID1.png")).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o644);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const row = store.db.prepare("SELECT media_path FROM messages WHERE id = 'MSGID1'").get() as {
      media_path: string;
    };
    expect(row.media_path).toBe(path);
  },
);

function storeMessageRow(store: Store): void {
  store.db
    .prepare(
      "INSERT INTO messages (id, chat_jid, sender_jid, timestamp, mentions, is_from_me, is_unread) VALUES (?, ?, ?, ?, ?, 1, 0)",
    )
    .run("MSGID1", "358497773518@s.whatsapp.net", null, new Date().toISOString(), "[]");
}

test("MediaError instances carry their code", () => {
  const err = new MediaError("TOO_LARGE", "too big");
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe("TOO_LARGE");
});
