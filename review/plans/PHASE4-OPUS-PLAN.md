# Phase 4 — voice / video / document understanding (T121–T130)

## Context
0.9.0 ships transcription (mock/openai/mlx + `transcripts` cache) but agents can't see transcripts in `list_messages`, videos have no audio transcript, there's no offline whisper.cpp engine, BYOK keys can only be set via env, documents aren't readable, and doctor says nothing about engines. Phase 4 closes GAPs 1–6 without adding any hard dependency.

Things I found that change the plan (verified in code today):
- `serveTranscribe` (`packages/bridge/src/http.ts:2043`) turns **every** engine failure into `500 INTERNAL "transcription failed"`. That includes the `CONFIG:` error thrown by `OpenAITranscriptionEngine`. It also hardcodes `"audio/ogg"`. So structured setup errors have to come first (T121); every later engine depends on them.
- `MlxTranscriptionEngine` reports a missing binary as `FFMPEG_UNAVAILABLE`, which is the wrong code. `MediaErrorCode` (`media/resolve.ts:7`) has no engine codes.
- Nothing stores bridge-side config: no `config.json` exists in bridge or cli. BYOK needs a new `<dataDir>/config.json` (0600, same discipline as `token`).
- The `transcripts` PK is `(chat_jid, message_id, engine)` and has no `kind` column. Documents and OCR text need a label, so V20 adds one.
- Existing source still has `/** T90 */` and `//` comments (transcribe.ts, view.ts, http.ts). The zero-comment rule applies to **new/edited lines only**. No drive-by sweeps.

Conventions for every task: a RED commit (`test(...)`) with the failing assertion quoted in VERIFY, then a GREEN commit (`feat|fix(...)`). Gates are `vp check` exit 0 + full `vp test` green + coverage ≥80% (bridge/mcp-server). Each task ends with one VERIFY.md line and ticks GOAL only after that. Live checks use the real daemon, the **Test group + owner number only**, one message per leg, and no repeats.

---

### T121 — Structured engine errors + real MIME passthrough
- **Goal:** Engine misconfiguration or a missing binary returns a typed 4xx with setup instructions instead of a bare 500. `/api/transcribe` passes the message's real MIME and filename.
- **Acceptance:**
  - `transcribe.test.ts`: `createTranscriptionEngine("openai")` with no key throws `MediaError` code `ENGINE_NOT_CONFIGURED` whose message contains `wa-mcp config set transcription.api_key`.
  - mlx spawn ENOENT → code `ENGINE_UNAVAILABLE` (not `FFMPEG_UNAVAILABLE`).
  - `http.test.ts`: POST `/api/transcribe` with `WA_TRANSCRIBE_ENGINE=openai` and no key → status 422, body `error.code === "ENGINE_NOT_CONFIGURED"`, `error.setup` is a non-empty string.
  - An engine spy receives the stored `media_type`-derived mime, not the literal `"audio/ogg"`, for an `audio/mp4` fixture.
- **Files:** `bridge/src/media/resolve.ts` (add 2 codes), `bridge/src/media/transcribe.ts`, `bridge/src/http.ts` (serveTranscribe catch + mime), `bridge/tests/media/transcribe.test.ts`, `bridge/tests/http.test.ts`, `mcp-server/tests/tools.test.ts` (transcribe_message surfaces `error.setup`).
- **Risks:** Existing tests that assert `FFMPEG_UNAVAILABLE` for mlx need to be updated in the RED commit, and that change should be called out. The 422 vs 500 change alters the HTTP contract, so check the web-ui/mcp error mappers.
- **Live:** With `WA_TRANSCRIBE_ENGINE=openai` and the key unset, call `transcribe_message` on an existing Test-group voice note. Expect a 422 with setup text. Nothing is sent.

### T122 — V20 `transcripts.kind` + surface transcripts in list_messages / get_message_context (GAP 1)
- **Goal:** Message rows carry `transcript: { text, engine, kind, language, truncated }` whenever any cached transcript exists.
- **Acceptance:**
  - `schema.test.ts`: after migrate, `PRAGMA table_info(transcripts)` includes `kind` with default `'audio'`, and `migrations` max version = 20.
  - New `queries` test: save a transcript for msg A, then `listMessages(...)` gives A `.transcript.text === <saved>` and B `.transcript === undefined`. With two engines cached, the latest `created_at` wins. Text >2000 chars is cut to 2000 with `truncated: true`.
  - `getMessageContext` target carries the transcript.
  - `tools.test.ts`: the `list_messages` description mentions transcripts.
- **Files:** `bridge/src/store/schema.ts` (MIGRATION_V20), `bridge/src/store/queries.ts` (`attachTranscripts` beside `attachPolls`, used in listMessages/getMessageContext/search paths at :329/:379/:431/:461), `bridge/src/media/transcribe.ts` (`saveTranscript` gets a `kind` param, default `audio`), `mcp-server/src/tools.ts:574`, `bridge/tests/store/schema.test.ts`, `bridge/tests/store/queries*.test.ts`.
- **Risks:** N+1 queries: do one `IN (...)` query per page, same as attachPolls. Payload bloat: hence the truncation cap. Migration on large live DBs is an `ALTER ADD COLUMN`, which is cheap.
- **Live:** Owner sends one voice note to the Test group, then `transcribe_message`, then `list_messages` on Test group. The row shows `transcript.text`.

### T123 — BYOK config store + `wa-mcp config set|get|unset|list` (GAP 4, CLI)
- **Goal:** Keys and engine settings live in `<dataDir>/config.json` (mode 0600). Env still overrides. The bridge reads config on each call, so no restart is needed.
- **Acceptance:**
  - New `cli/tests/t123-config.test.ts`: `config set transcription.api_key sk-x` produces a file of mode `0o600` containing the key.
  - `config get transcription.api_key` prints `sk-…x` (masked), never the full key. `--reveal` is not offered.
  - An unknown key exits 1 and lists the allowed keys: `transcription.engine|api_key|base_url|model`, `whisper.bin|model`, `ocr.engine`.
  - `unset` removes the key.
  - Bridge test: with config `transcription.engine=mock` and the env unset, `/api/transcribe` uses mock. With env `WA_TRANSCRIBE_ENGINE` set, env wins.
  - `bin-usage.test.ts`: help lists `config`.
- **Files:** new `bridge/src/config.ts` (read/merge, env precedence), `bridge/src/media/transcribe.ts` (factory takes resolved config), `bridge/src/http.ts:2069`, `cli/src/commands.ts` + `cli/src/bin.ts`, `cli/tests/t123-config.test.ts`, `cli/tests/bin-usage.test.ts`.
- **Risks:** Secret at rest is plaintext, so enforce 0600 and refuse to read a group/world-readable file (same as the doctor token check). Never log the key and never return it over HTTP. Windows has no posix perms, so mirror the doctor's win32 branch.
- **Live:** `wa-mcp config set transcription.engine openai` + key + base_url, with no env. `transcribe_message` on a Test-group voice note returns real text with `cached:false`. A second call returns `cached:true`.

### T124 — Web Settings: transcription section (GAP 4, web)
- **Goal:** The Settings page can view (masked) and set the engine, base URL, model, and API key through `GET/PUT /api/config`.
- **Acceptance:**
  - `pages.test.ts`: `settingsHtml(...)` contains `id="transcription-engine"` (a select of the supported engines) and `id="transcription-api-key"` (`type="password"`).
  - `http.test.ts`: `GET /api/config` never contains the raw key (assert `!body.includes("sk-test-full")`). `PUT /api/config` with an unknown key → 422. PUT without the bearer token → 401.
  - `api.test.ts`: `saveConfig` issues a PUT with JSON.
- **Files:** `web-ui/src/pages.ts:235`, `web-ui/src/api.ts`, `web-ui/src/app.ts`, `bridge/src/http.ts` (new route, token-gated), `web-ui/tests/pages.test.ts`, `web-ui/tests/api.test.ts`, `bridge/tests/http.test.ts`.
- **Risks:** XSS: escape every value via `escape.ts`. An empty password field on save must not wipe the stored key; only an explicit "clear" removes it. This is the first write-config HTTP surface, so it stays token-only and gets no query-token fallback.
- **Live:** Open the web UI, set engine=mock, and confirm `wa-mcp config get transcription.engine` → `mock`. No WhatsApp traffic.

### T125 — `whisper-local` engine (whisper.cpp `whisper-cli`) (GAP 3)
- **Goal:** `WA_TRANSCRIBE_ENGINE=whisper-local` runs ffmpeg (→16 kHz mono wav), then `whisper-cli -m <model> -f in.wav -oj -of out`. A missing binary or model is a structured error and never a crash.
- **Acceptance:**
  - `transcribe.test.ts` with a mocked spawn: argv[0] is `whisper.bin` (default `whisper-cli`), the args include `-m <model> -f … -oj`, and parsing the fixture `out.json` (`transcription[].text` joined) gives the expected text.
  - Spawn ENOENT → `ENGINE_UNAVAILABLE` with setup text mentioning `brew install whisper-cpp` / `whisper.bin`.
  - Missing `whisper.model` → `ENGINE_NOT_CONFIGURED`.
  - `SUPPORTED_TRANSCRIPTION_ENGINES` includes `"whisper-local"`.
  - The tmp dir is removed on success and on failure (assert `existsSync === false`).
- **Files:** `bridge/src/media/transcribe.ts` (new class following the `MlxTranscriptionEngine` spawn pattern + an ffmpeg wav step, either shared with T126 or reusing the view.ts spawn shape), `bridge/tests/media/transcribe.test.ts`, fixture `bridge/tests/fixtures/whisper-out.json`.
- **Risks:** whisper-cli JSON output differs between versions, so accept both `transcription[]` and `text`. Long audio takes CPU minutes; add a timeout that kills the child and returns `ENGINE_UNAVAILABLE`. Model paths are user-supplied: pass them as an argv element, never through a shell.
- **Live:** On the owner's Mac with `brew install whisper-cpp` + a `ggml-base.bin` model, `config set transcription.engine whisper-local`. Transcribe one Test-group voice note with networking off (or show the egress-free log). Also run once with the binary renamed and get the structured error.

### T126 — Video audio-track transcription (GAP 2)
- **Goal:** `transcribe_message` accepts video messages (ffmpeg `-vn` audio extraction → engine), and `view_video` returns `{frames, transcript?}` (GOAL L142 promises "frames+transcript").
- **Acceptance:**
  - `transcribe.test.ts`/`view.test.ts` with a mocked spawn: for `video/mp4`, ffmpeg is called with `-vn -ac 1 -ar 16000 -f wav pipe:1` before the engine, and the engine receives `audio/wav`. The transcript is saved with `kind:"video"`.
  - A video with no audio stream (ffmpeg exit≠0 / empty) → `view` still returns frames with `transcript: null`. `transcribe_message` → 422 `NO_AUDIO_TRACK`.
  - `http.test.ts`: `/api/media/:id/view` for video includes the `transcript` key. It is opt-out via `{transcribe:false}`.
  - The cache hit path does not re-run ffmpeg (spawn call count = 0 on the 2nd call).
- **Files:** `bridge/src/media/view.ts`, `bridge/src/media/transcribe.ts` (`extractAudio`), `bridge/src/http.ts` (view route :2607, serveTranscribe), `mcp-server/src/tools.ts` (view_video/transcribe_message descriptions), `bridge/tests/media/view.test.ts`, `bridge/tests/media/transcribe.test.ts`, `bridge/tests/http.test.ts`.
- **Risks:** View latency gets worse because transcription runs synchronously, so cap it at the existing cache plus a timeout. Silence fills the transcript via the paid engine, which costs money; that's the reason for the opt-out. A missing ffmpeg must still return the existing `FFMPEG_UNAVAILABLE` error.
- **Live:** Owner sends one ~10s talking video to the Test group. `view_video` returns ≤8 frames + transcript text, and `list_messages` shows `transcript.kind === "video"`.

### T127 — Document text extraction: DOCX (built-in) + PDF (`pdftotext`, optional) (GAP 5a)
- **Goal:** A new `read_document` MCP tool / `POST /api/media/:id/text` extracts text. DOCX is read with zero deps (zip central directory + `node:zlib.inflateRawSync` → `word/document.xml` `<w:t>`). PDF uses the poppler `pdftotext` binary if it's present, otherwise a structured `ENGINE_UNAVAILABLE`. Results are cached in `transcripts` with `kind:"document"`.
- **Acceptance:**
  - New `bridge/tests/media/document.test.ts`: the fixture `hello.docx` (committed, <5 KB) → text `"Hello Phase 4"` with paragraph breaks preserved. A corrupt zip → `VALIDATION_ERROR`.
  - PDF with mocked spawn: args are `[path, "-layout", "-"]` and stdout comes back as text. ENOENT → `ENGINE_UNAVAILABLE` with setup text mentioning `brew install poppler`.
  - An unsupported mime (`application/zip`) → 422.
  - Text over 1 MB is truncated with `truncated:true`.
  - `tools.test.ts`: `read_document` is registered with `readOnlyHint:true`, and `exports-discipline`/parity tests are updated.
- **Files:** new `bridge/src/media/document.ts`, `bridge/src/http.ts`, `mcp-server/src/tools.ts` (+ annotations block ~:2318), `bridge/tests/media/document.test.ts`, `bridge/tests/fixtures/hello.docx`, `hello.pdf`, `mcp-server/tests/tools.test.ts`, the tool-parity doc.
- **Risks:** Zip bombs: cap the inflated size (e.g. 20 MB) and the entry count. Zip64 or encrypted DOCX should fail with a structured error, not a hang. XML entity decoding is limited to the 5 predefined entities plus numeric ones. The new tool changes the tool-count assertions and the ACCOUNTING census, so `pnpm run accounting:check` must stay green.
- **Live:** From the owner's phone, send one small DOCX and one small text PDF to the Test group. `read_document` returns text for both, and `list_messages` shows `transcript.kind === "document"`.

### T128 — Optional OCR behind `WA_OCR_ENGINE` (default `none`) (GAP 5b)
- **Goal:** `ocr.engine=tesseract` OCRs images (via `read_document` on an image) and scanned PDFs (when pdftotext returns blank, rasterize with `pdftoppm` and run tesseract). With the default `none`, nothing is invoked.
- **Acceptance:**
  - With `ocr.engine` unset, `read_document` on `image/jpeg` → 422 `ENGINE_NOT_CONFIGURED` whose setup mentions `wa-mcp config set ocr.engine tesseract`, and the spawn spy count is 0.
  - With `tesseract` (mocked spawn): args are `[img, "-", "-l", <lang default eng>]` and the result is saved with `kind:"ocr"`.
  - A blank pdftotext output plus OCR enabled → pdftoppm, then the tesseract chain is invoked.
  - Missing binary → `ENGINE_UNAVAILABLE` with setup mentioning `brew install tesseract`.
- **Files:** new `bridge/src/media/ocr.ts`, `bridge/src/media/document.ts`, `bridge/src/config.ts` (`ocr.lang`), `bridge/tests/media/ocr.test.ts`.
- **Risks:** Multi-page scans are slow, so cap pages (e.g. 10) and note `truncated`. Tesseract language packs may be missing, so its stderr maps to a setup hint.
- **Live:** On the owner's Mac with tesseract installed, the owner sends one screenshot to the Test group, and `read_document` returns OCR text. Then set `ocr.engine` back to none and repeat to get the structured error.

### T129 — `wa-mcp doctor --engines` (GAP 6)
- **Goal:** Doctor reports each engine as `available | not-configured | unavailable` with a fix hint: openai key present (masked) / base_url, mlx bin on PATH, whisper-cli + model file, ffmpeg, pdftotext, pdftoppm, tesseract, active `transcription.engine`/`ocr.engine`. Optional engines never make doctor fail; only the **selected** engine being broken does.
- **Acceptance:**
  - `doctor.test.ts` with an injected `which`/`existsSync`/config: no engines installed + engine=mock → `report.ok === true`, with each optional check marked `optional:true`.
  - engine=whisper-local + whisper-cli missing → `ok === false`, and the detail includes `brew install whisper-cpp`.
  - The openai detail never contains the full key.
  - Without `--engines` the check list is unchanged (snapshot of names).
  - `bin-usage.test.ts`: help mentions `--engines`.
- **Files:** `cli/src/doctor.ts` (add an injectable `whichFn`), `cli/src/bin.ts:243`, `cli/tests/doctor.test.ts`, `cli/tests/bin-usage.test.ts`. Reuse the T123 config reader by importing from `@wa-mcp/shared` or a cli copy; check the export-discipline test first.
- **Risks:** PATH probing differs per platform (`where` on win32). Keep it as a pure `which` implementation that splits `PATH`, with no child process.
- **Live:** Run `wa-mcp doctor --engines` on the owner's Mac before and after `brew install whisper-cpp`. The output differs only in the whisper line.

### T130 — Docs, skill, ledger close
- **Goal:** Document engines/BYOK/doctor in getting-started + a "Media understanding" page, update the `wa-media` skill content, record VERIFY lines, and close Phase 4 in GATES.
- **Acceptance:**
  - A new drift-guard test (pattern from `t117-cookbook.test.ts`/`t120-pair-docs.test.ts`) asserts that every `config` key in `config.ts` and every engine in `SUPPORTED_TRANSCRIPTION_ENGINES` appears in the docs page.
  - `docs:build` exits 0. `pnpm run accounting:check` passes. Every Phase 4 VERIFY line cites T121–T129.
  - GOAL L142/L143/L148/L252 are re-dispositioned from OUT-OF-SCOPE/DEFERRED to ticked with `VERIFY:` anchors only where live evidence exists.
- **Files:** `docs/**`, `packages/cli/skills/wa-media/**` (if present), `skill-content.test.ts`, `review/VERIFY.md`, `review/GATES.md`, `GOAL.md`, `review/ACCOUNTING.md`.
- **Risks:** Re-ticking boxes previously marked OUT-OF-SCOPE changes the accounting counts, so update ACCOUNTING in the same commit.
- **Live:** A final chain on the Test group: voice note → whisper-local transcript; video → frames + transcript; DOCX → text; `list_messages` shows all three `transcript.kind`s. Four owner-sent messages, zero bot sends.

---

## Ordering rationale
T121 (error contract) is the base everything sits on. T122 (surface + V20 `kind`) has to land before any new producer writes kinds. T123 (config) comes before the engines that read config (T125, T127, T128) and before the web (T124) and doctor (T129) consumers. T130 closes the phase. T124 and T125 can run in parallel after T123.

## Verification (per task and at phase end)
`vp check` → exit 0; `vp test --coverage` → all green, thresholds held; `pnpm run accounting:check` → 0; the live step above on the real daemon (Test group + owner only), with its output pasted into VERIFY.md.
