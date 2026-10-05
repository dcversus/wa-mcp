import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { extractAudio } from "../../src/media/transcribe.ts";

class FakeChild {
  handlers: Record<string, (arg?: unknown) => void> = {};
  stdin = {
    on: () => undefined,
    end: () => undefined,
  };
  on(event: string, handler: (arg?: unknown) => void): this {
    this.handlers[event] = handler;
    return this;
  }
  emit(event: string, arg?: unknown): void {
    this.handlers[event]?.(arg);
  }
}

test("extractAudio spawns ffmpeg with -vn and writes a wav", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t126-"));
  const calls: Array<{ bin: string; args: string[] }> = [];
  try {
    const buffer = Buffer.from("fake-video-bytes");
    await extractAudio(buffer, "video/mp4", {
      ffmpegPath: "ffmpeg",
      spawnFn: ((bin: string, args: string[]) => {
        calls.push({ bin, args });
        const child = new FakeChild();
        const outFile = args[args.length - 1];
        setImmediate(() => {
          writeFileSync(outFile, "wav-bytes");
          child.emit("close", 0);
        });
        return child as unknown as never;
      }) as never,
      tmpDir: dir,
    });
    expect(calls.length).toBe(1);
    expect(calls[0]!.bin).toBe("ffmpeg");
    expect(calls[0]!.args).toContain("-vn");
    expect(calls[0]!.args).toContain("wav");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extractAudio rejects with ENGINE_UNAVAILABLE when ffmpeg is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t126-"));
  try {
    await expect(
      extractAudio(Buffer.from("x"), "video/mp4", {
        ffmpegPath: "ffmpeg",
        spawnFn: ((bin: string) => {
          const child = new FakeChild();
          setImmediate(() => {
            child.emit(
              "error",
              Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }),
            );
          });
          return child as unknown as never;
        }) as never,
        tmpDir: dir,
      }),
    ).rejects.toThrowError(/ffmpeg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
