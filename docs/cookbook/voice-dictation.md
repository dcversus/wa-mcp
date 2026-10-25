# Voice notes as /voice dictation

Speak to Claude Code through WhatsApp: send a voice note, hold the dictation
key in Claude Code, and the note is transcribed into the prompt by Claude
Code's own `/voice` speech-to-text — no local transcription engine, no API
key, no ffmpeg inside the container.

```text
WhatsApp voice note → wa-mcp bridge (ogg → raw PCM via ffmpeg)
                    → rec shim on stdout
                    → Claude Code /voice dictation → transcript in the prompt
```

## How it works

Claude Code's `/voice` dictation records from a microphone. On Linux, when
its native audio module cannot capture (headless hosts, containers), it
falls back to spawning SoX's `rec` and streams that process's stdout to
Anthropic's transcription service. `wa-mcp voice install` puts a shim named
`rec` (plus `sox`, for Claude Code's availability probes) on `PATH`: instead
of recording, it fetches your next unplayed WhatsApp voice note from the
bridge as raw 16 kHz mono PCM and writes it to stdout. To Claude Code the
shim is indistinguishable from a microphone.

The bridge serves notes oldest-first with a cursor (`meta` key
`voice_dictation_cursor`); each successful dictation consumes one note. Both
voice notes and video notes count; shared audio files do too (WhatsApp does
not distinguish them in the store).

## Setup

Host with the bridge (ffmpeg converts ogg → PCM):

```sh
brew install ffmpeg        # or apt install ffmpeg / apk add ffmpeg
```

Where Claude Code runs (same machine or a container):

```sh
wa-mcp voice install --bin-dir ~/.local/bin
wa-mcp voice test          # probes + one end-to-end serve (consumes a note)
```

Then in Claude Code: run `/voice` once to enable dictation, and hold/tap the
dictation key (Space) whenever you have unplayed WhatsApp voice notes. The
note's transcript lands in the prompt exactly like dictated speech.

Requirements:

| where            | needs                                                             |
| ---------------- | ----------------------------------------------------------------- |
| Claude Code side | claude.ai sign-in (dictation is unavailable with API-key auth)    |
| Claude Code side | `rec`+`sox` shims on `PATH` (installed above)                     |
| Claude Code side | curl or wget (alpine's busybox wget is fine)                      |
| bridge side      | ffmpeg (the daemon's doctor names the install command if missing) |

Dictation language follows Claude Code's `language` setting — set it to the
language of your voice notes (`/config`), or transcripts come back in
English by default.

## Claude Code inside docker (alpine)

Containers have no microphone, which is exactly why the `rec` fallback is
used — the flow needs no audio hardware at all:

```sh
# inside the container (node ≥ 22.5 for wa-mcp):
npx wa-mcp voice install --bin-dir /usr/local/bin \
  --bridge-url http://127.0.0.1:27777 --token <bridge-token>
```

- Linux hosts: run the container with `--network host` so the bridge's
  loopback bind is reachable as `127.0.0.1:27777`.
- Docker Desktop: `--network host` on recent versions, otherwise forward the
  port (`socat TCP-LISTEN:27777,fork TCP:host.docker.internal:27777` inside
  the container) and pass `--bridge-url http://127.0.0.1:8080`.
- The shims are plain POSIX sh and work in alpine's busybox ash.

## Troubleshooting

- `rec --version: exit …` from `wa-mcp voice test` — shims missing from
  `PATH`; reinstall with `--bin-dir` on the `PATH` Claude Code sees.
- `Voice mode requires SoX for audio recording` in Claude Code — the
  `sox` probe failed; check `wa-mcp voice test`.
- `Voice mode requires a Claude.ai account` — `/voice` needs a claude.ai
  sign-in; API-key/Bedrock/Vertex auth disables dictation entirely.
- "No audio detected" while holding the key — the queue is empty (every
  served note was already dictated). `wa-mcp voice test` shows `pending: N`.
- `422 ENGINE_UNAVAILABLE` naming ffmpeg — install ffmpeg where the bridge
  runs; it converts ogg/opus to raw PCM.
- `voice: no PCM served` — bridge unreachable from where Claude Code runs
  (see the docker section) or the bridge token changed since install.

`wa-mcp voice uninstall` removes the shims and the env file; the store
cursor stays, so already-dictated notes are never re-served.
