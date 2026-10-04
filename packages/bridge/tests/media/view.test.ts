import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vite-plus/test";
import { viewMedia } from "../../src/media/view.ts";

function fakeFfmpeg(frames: number, exitCode = 0) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const spawn = ((file: string, args: string[]) => {
    calls.push({ file, args });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => {
      for (let i = 0; i < frames; i += 1) {
        proc.stdout.emit("data", Buffer.from(`frame${i};`));
      }
      proc.emit("close", exitCode);
    });
    return proc;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawn: spawn as typeof spawn, calls };
}

describe("T90 line142 — viewMedia", () => {
  test("image under the cap returns base64 + mime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-view-"));
    const path = join(dir, "pic.jpg");
    writeFileSync(path, Buffer.from("jpeg-bytes"));
    const result = await viewMedia({ path, mime: "image/jpeg" }, {});
    expect(result?.mime).toBe("image/jpeg");
    expect(result?.frames).toHaveLength(1);
    expect(Buffer.from(result?.frames[0]?.data_base64 ?? "", "base64").toString()).toBe(
      "jpeg-bytes",
    );
  });

  test("oversized image is a structured PAYLOAD_TOO_LARGE", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-view-"));
    const path = join(dir, "big.jpg");
    writeFileSync(path, Buffer.alloc(6 * 1024 * 1024));
    await expect(viewMedia({ path, mime: "image/jpeg" }, {})).rejects.toHaveProperty(
      "code",
      "PAYLOAD_TOO_LARGE",
    );
  });

  test("video samples up to 8 evenly-seeked frames via ffmpeg", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-view-"));
    const path = join(dir, "clip.mp4");
    writeFileSync(path, Buffer.from("fake-video"));
    const { spawn, calls } = fakeFfmpeg(4);
    const result = await viewMedia({ path, mime: "video/mp4" }, { spawnFn: spawn });
    expect(result?.frames.length).toBeLessThanOrEqual(8);
    expect(calls[0]?.file).toBe("ffmpeg");
    expect(calls[0]?.args).toContain("-vf");
    expect(result?.frames.every((f) => f.data_base64.length > 0)).toBe(true);
  });

  test("ffmpeg absence is a structured FFMPEG_UNAVAILABLE", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-view-"));
    const path = join(dir, "clip.mp4");
    writeFileSync(path, Buffer.from("v"));
    const { spawn } = fakeFfmpeg(0, 127);
    await expect(viewMedia({ path, mime: "video/mp4" }, { spawnFn: spawn })).rejects.toHaveProperty(
      "code",
      "FFMPEG_UNAVAILABLE",
    );
  });
});
