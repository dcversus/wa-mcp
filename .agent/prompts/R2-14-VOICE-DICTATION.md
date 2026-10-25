# TASK: R2-14 — WhatsApp voice notes as Claude Code /voice dictation (TDD, no commit)

## Owner need (verbatim)
> make possible flow -> user send a whatsapp voice message -> wa-mcp (for
> claude) emits this file properly as /voice
> https://code.claude.com/docs/en/voice-dictation even if claude code
> running inside docker at alpine (or at least requirements are simple)

## Mechanism (verified facts — do not re-derive)

Extracted from the official claude binary 2.1.310 (voice recorder module,
statically de-minified; see review/VERIFY.md R2-14 for the dump anchor):

- `/voice` dictation transcribes a LIVE audio stream to Anthropic's STT
  websocket. There is no audio-file attachment path in Claude Code
  (changelog + docs verified 2026-10-25; MCP audio tool results are only
  saved to disk, v2.1.69).
- Recording prefers a native audio-capture addon. `isNativeAudioAvailable()`
  only checks the module LOADED. When the addon loads but cannot open a
  capture device (docker/headless), `startRecording` FALLS THROUGH to the
  SoX spawn — this is the docker/alpine lever.
- Availability probes: `sox --version` and `rec --version` must exit 0
  (exit code only; output ignored; 3s timeout).
- Exact record spawn (verbatim):
  `rec -q --buffer 1024 -t raw -r 16000 -e signed -b 16 -c 1 - silence 1 0.1 3% 1 2.0 3%`
  stdout must be RAW signed 16-bit little-endian PCM, 16 kHz, mono;
  stdout chunks are streamed live; stop = SIGTERM; process exit finalizes.
- Docs contract: https://code.claude.com/docs/en/voice-dictation — needs a
  claude.ai sign-in (no API-key/Bedrock/Vertex auth); language follows the
  `language` setting.

So: a shim named `rec` (+ `sox` for the probes) that streams the next
WhatsApp voice note as raw s16le 16 kHz mono PCM on stdout is
indistinguishable from a microphone. The voice note's transcript lands in
the Claude Code prompt exactly like a dictated message.

## Build

1. Bridge (`packages/bridge/src/media/dictation.ts`):
   - `toDictationPcm(buffer, mime, { ffmpegPath?, spawnFn? })` — ffmpeg
     `-i pipe:0 -vn -ar 16000 -ac 1 -f s16le pipe:1`; `MediaError`
     `ENGINE_UNAVAILABLE` naming the ffmpeg install command on failure
     (mirror media/voice.ts error style).
   - FIFO cursor over `messages`: `voice_dictation_cursor` in `meta`;
     serve oldest inbound (`is_from_me = 0`) row with `media_type IN
     ('audio','video')` and non-null `media_path` at `rowid > cursor`
     (rowid = arrival order; composite PK is not sequential).
   - HTTP (auth like every /api route):
     - `GET /api/voice/next` — JSON peek `{ pending, next }` (no cursor move)
     - `GET /api/voice/next.pcm` — 200 raw PCM (`audio/L16;rate=16000;channels=1`,
       `x-wa-mcp-voice-rowid` header), 204 when nothing pending, 422
       ENGINE_UNAVAILABLE when ffmpeg is missing, 404 when the stored file
       is gone. Cursor advances only after successful conversion.
2. CLI (`packages/cli/src/voice-dictation.ts`, command `wa-mcp voice`):
   - `voice install [--bin-dir <dir>] [--bridge-url <url>] [--token <t>] [--force]`
     — writes ONE shim to `<bin-dir>/rec` AND `<bin-dir>/sox` (0755) plus
     `~/.wa-mcp/voice-shim.env` (0600: WA_VOICE_BRIDGE_URL, WA_VOICE_TOKEN).
     Shim: `--version` → sox-style line, exit 0; record invocation →
     `curl -fsSL -H "Authorization: Bearer …" $URL/api/voice/next.pcm`
     (busybox `wget -q -O -` fallback), exec'd so SIGTERM lands on the
     fetcher. Marker line `# wa-mcp voice-dictation shim` — idempotent
     overwrite of OUR shims; refuse foreign rec/sox without `--force`.
   - `voice uninstall [--bin-dir <dir>]` — removes our shims + env file.
   - `voice test [--bin-dir <dir>]` — verifies `rec`/`sox` `--version`
     probes exit 0, then spawns `rec` with the EXACT Claude Code argv
     above and reports served bytes (consumes the next pending note).
   - register in shared cli-reference (`voice` command, daemon group) +
     bin.ts dispatch.
3. Docs + skills:
   - new `docs/cookbook/voice-dictation.md` (flow, requirements table,
     docker/alpine: `--network host` / `host.docker.internal` + bridge
     reachability, claude.ai-auth + `language` notes, CC error strings →
     fixes); link from media-understanding.md + cookbook index.
   - skills/wa-mcp/SKILL.md + packages/cli copy: voice-note guidance now
     mentions the /voice flow (`wa-mcp voice test`).
   - CHANGELOG unreleased entry.
4. Tests (RED first, exact assertion evidence in the report):
   - bridge unit: pcm args via fake spawn; ENGINE_UNAVAILABLE mapping;
     FIFO order; is_from_me/media_type/media_path filters; cursor
     persistence.
   - bridge http: 401 without token; peek JSON; 204 empty; 200 PCM bytes +
     cursor advance; two serves FIFO order.
   - cli: install writes shims (mode, marker, env 0600), idempotent,
     foreign-refusal with/without --force, uninstall; `--version` probes
     exit 0; record against a stub HTTP server returns served bytes via
     the exact CC argv.
5. Gates: `vp check` 0; `vp test` full green; `pnpm run docs:build` (new
   page links); no new env vars scanned by env-doc-coverage (shim envs are
   file-baked, documented in the cookbook page only). Do not commit.

## Constraints
- Zero new runtime deps (shim is POSIX sh + curl/busybox wget).
- No live WhatsApp sends; docker/alpine live verification is owner
  dogfood — unit + local-shim verification is the gate (VERIFY: unit;
  PENDING: live for the in-container leg).
- Loopback default unchanged; container networking is documentation
  (`--network host`), not a bind-surface change.

## Report
Files, RED→GREEN list, the pinned CC argv, gates output.
