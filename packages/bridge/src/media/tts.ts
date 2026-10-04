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

/** T90 line144: any OpenAI-compatible /audio/speech endpoint (openai engine).
 * Returns ogg/opus for WhatsApp voice notes when the endpoint supports the
 * ogg response format; falls back to the endpoint's bytes as-is. */
export class OpenAITtsEngine implements TtsEngine {
  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      fetchFn?: typeof fetch;
      model?: string;
      voice?: string;
    },
  ) {
    if (config.baseUrl.length === 0 || config.apiKey.length === 0) {
      throw new Error("CONFIG: openai tts needs WA_OPENAI_BASE_URL and WA_OPENAI_API_KEY");
    }
  }

  async synthesize(text: string): Promise<TtsResult> {
    const fetchFn = this.config.fetchFn ?? fetch;
    const response = await fetchFn(
      `${this.config.baseUrl.replace(/\/$/, "")}/audio/speech`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model ?? "tts-1",
          voice: this.config.voice ?? "alloy",
          input: text,
          response_format: "opus",
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`openai tts failed: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mime: "audio/ogg" };
  }
}

export function createTtsEngine(engine: string, env: NodeJS.ProcessEnv = process.env): TtsEngine {
  if (engine === "mock") {
    return new MockTtsEngine();
  }
  if (engine === "openai") {
    return new OpenAITtsEngine({
      baseUrl: env.WA_OPENAI_BASE_URL ?? "",
      apiKey: env.WA_OPENAI_API_KEY ?? "",
    });
  }
  throw new Error(`unsupported tts engine: ${engine} (supported: mock, openai)`);
}
