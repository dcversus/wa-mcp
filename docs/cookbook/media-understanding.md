# Media understanding — voice, video, documents

wa-mcp turns WhatsApp media into text an agent can use. Every result is
cached as a transcript on the message (never re-transcribed).

## Voice notes

```sh
wa-mcp config set transcription.engine mock   # or openai | mlx | whisper-local
```

`transcribe_message` (MCP tool) or `POST /api/transcribe` transcribes a voice
note once; every later `list_messages` on that chat carries
`transcript { text, engine, kind, language, truncated }` on the message.

Engines:

| engine          | needs                   | notes                                                                                                           |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mock`          | nothing                 | default; returns canned text (safe for tests)                                                                   |
| `openai`        | `transcription.api_key` | any OpenAI-compatible endpoint (`transcription.base_url`), model `whisper-1` by default (`transcription.model`) |
| `mlx`           | `mlx_whisper` binary    | macOS on-device (`pip install mlx-whisper`)                                                                     |
| `whisper-local` | `whisper-cli` + model   | whisper.cpp; set `WA_WHISPER_MODEL` to a ggml `.bin` path (`brew install whisper-cpp`)                          |

A missing key or binary returns `422 ENGINE_NOT_CONFIGURED` /
`ENGINE_UNAVAILABLE` with the exact install command — never a silent 500.

## Video messages

`transcribe_message` accepts videos too: the audio track is extracted with
ffmpeg (`-vn`, 16 kHz mono wav) and run through the same engine. A video with
no audio track fails with `ENGINE_UNAVAILABLE` naming the cause.

## Documents

The `read_document` tool (or `POST /api/media/<id>/text`) extracts text:

- **DOCX** — built-in, no external dependency (zip + XML parse, 20 MB
  inflate cap, 200-entry cap)
- **PDF** — needs `pdftotext` (`brew install poppler`); structured
  `ENGINE_UNAVAILABLE` with the install hint when missing
- **images** — OCR, only when `WA_OCR_ENGINE=tesseract` is set (default
  off; `brew install tesseract`)

Results over 1M characters come back `truncated: true` and are cached with
`kind: "document"`.

## BYOK keys

Keys live in `~/.wa-mcp/config.json` (mode 0600, never group/world-readable):

```sh
wa-mcp config set transcription.api_key sk-...
wa-mcp config get transcription.api_key    # masked: sk-…3456
wa-mcp config list
```

Environment variables always win over the file
(`WA_TRANSCRIBE_ENGINE`, `WA_OPENAI_API_KEY`, `WA_OPENAI_BASE_URL`,
`WA_OPENAI_MODEL`). The web UI Settings page edits the same values (the raw
key is never returned to the browser — only masked).

## Doctor

```sh
wa-mcp doctor --engines
```

Reports each engine as available / not-configured (optional engines never
fail the check) or fails with a fix hint when the SELECTED engine's binary
or model is missing. The openai key is always masked.
