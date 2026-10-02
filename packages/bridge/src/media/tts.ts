import { createHash } from "node:crypto";

export interface TtsResult {
  buffer: Buffer;
  mime: string;
}

export interface TtsEngine {
  synthesize(text: string): Promise<TtsResult>;
}

export class MockTtsEngine implements TtsEngine {
  async synthesize(text: string): Promise<TtsResult> {
    const hash = createHash("sha256").update(text).digest();
    const header = Buffer.from("OggS");
    const payload = Buffer.concat([header, Buffer.from("mock-tts"), hash]);
    return { buffer: payload, mime: "audio/ogg" };
  }
}
