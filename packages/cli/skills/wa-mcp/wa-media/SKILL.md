---
name: wa-media
description: Use when handling WhatsApp media — transcribing voice notes or videos, reading documents (DOCX/PDF), OCR of images, or configuring transcription engines and BYOK keys.
---

# wa-media — WhatsApp media understanding

The bridge turns media into text. Every transcript is cached on the message —
`list_messages` shows `transcript { text, engine, kind, language, truncated }`
without re-running engines.

## Tools

- `transcribe_message` — voice notes AND videos (audio track extracted via ffmpeg)
- `read_document` — DOCX (built-in) and PDF (`pdftotext`); images only with OCR enabled
- `view_image` / `view_video` — pixels for vision models

## Engine configuration

```sh
wa-mcp config list                              # current values (key masked)
wa-mcp config set transcription.engine openai   # mock | openai | mlx | whisper-local
wa-mcp config set transcription.api_key sk-...  # stored 0600, env WA_OPENAI_API_KEY wins
wa-mcp doctor --engines                         # availability + fix hints per engine
```

Rules of thumb:

- default engine is `mock` — switch before real use
- `openai` needs an API key (any OpenAI-compatible base URL works)
- `whisper-local` needs `whisper-cli` + `WA_WHISPER_MODEL` (ggml .bin)
- a missing binary/key returns 422 with the exact install command — never retry blindly

## Error codes

- `ENGINE_NOT_CONFIGURED` — key/model/env missing; the message says what to set
- `ENGINE_UNAVAILABLE` — binary missing or exited non-zero; includes install hint
- `TOO_LARGE` / `PAYLOAD_TOO_LARGE` — media over the caps (50MB docs, 5MB images)
