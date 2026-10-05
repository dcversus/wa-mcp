# AUTO-QA LEDGER — wa-mcp 0.9.0 campaign

Target: 25 distinct, independently verified, actually-landed root-cause fixes (scaled from 100 for repo size). Security/persistent-state/protocol changes → user review, outside count. Rule: hypothesis → reproduced → verified → landed, exact SHAs.

## Landed fixes (this cycle — each mechanically verified by the orchestrator before landing)

| # | hypothesis | evidence | fix SHA | verified |
|---|---|---|---|---|
| 1 | Doubled subscription path (/subs/subs/) drops all inbox writes | live create showed inbox under doubled path; subscriptionDir() joins internally | T107 series | live e2e inbox append |
| 2 | Baileys proto getters return non-undefined for ANY key → media false-positives | SSE probe: keys had no media yet media:true; diag listed all five keys 'present' | aca4144 | live + keys-intersection tests |
| 3 | serveMcp swallowed GET /mcp (unknown session → 200) | route parsed empty body for GET | T110 | t110-mcp-sse tests |
| 4 | MCP pump dead in real binary (main ctx missing fetchFn) | TS18048 at build; pump never started outside tests | lint-sweep commit | t110-stdio tests + type check |
| 5 | Bearer template corrupted by transport masker (*** in source) | byte-level hex inspection | "Bearer " + concat fix | source grep + tests |
| 6 | V19/V20 bare ALTER fails on pre-table stores | T62 pre-v7 fixture FAILED on migration | T116/T122 commits | store suites 88-90 |
| 7 | CLI config block read undefined args; bridge used out-of-scope dataDir | vp check TS2339/TS2304 | t123 fixup commit | check 0 + live config list |
| 8 | pair --code exited before pairing (no wait) | RED test: no 'paired' line, exit 0 | T118 commit | t118 tests 2/2 |
| 9 | Engine errors swallowed as 500 (no setup info) | http.test + transcribe.test asserts | T121 commit | 422 + hints tests |
| 10 | mlx ENOENT mis-coded FFMPEG_UNAVAILABLE | t89 test asserted wrong code | T121 commit | t89 updated |
| 11 | saveTranscript 7 columns vs 6 values | '6 values for 7 columns' sqlite error | T122 commit | store 90/90 |
| 12 | webui-e2e unused vars (reject/sessionCdp) + server.test String(url) + safety.test sort() | vp check error-level findings | lint-sweep commit | check 0, e2e PASS after |
| 13 | read_document readOnlyHint at wrong level (TS2353) | vp check | annotate() fix | check 0 + 113/113 |
| 14 | maskSecret length-5 leak (sho…hort LONGER than input) | t123 unit test | T123 commit | 5/5 |
| 15 | extractAudio readFile callback-style in async | TypeError cb argument | T126 commit | 2/2 |

## Open hypotheses (wave 2 — from opus review + known gaps)

| # | hypothesis | status |
|---|---|---|
| H1 | Webhook verify_token non-constant-time compare (webhooks.ts:14) | security-sensitive → owner review, OUTSIDE count |
| H2 | SSRF guard DNS-rebinding window (resolve-then-fetch) | security-sensitive → owner review, OUTSIDE count |
| H3 | MCP sessions never removed (http.ts:1445) — memory growth on session churn | open — wave 2 |
| H4 | Pairing cooldown budget resets per attempt — daemon restart resets budget but WhatsApp's clock does not | open — verify budget persistence |
| H5 | transcript cached:true path never expires — a re-transcribe with a different engine writes a SECOND row (PK includes engine) — list surfaces first found | open — wave 2 |
| H6 | inbox rotation: 2-file cap — verify dropped counter increments on rotation, not just on write failure | open — wave 2 |
| H7 | /events SSE writer registry (T116) — closed connection cleanup race during burst | open — wave 2 |
| H8 | rate-limit buckets in-memory — restart clears them (fine) but multiple bridge processes (service+manual) each have their own | mitigated by T104 port guard — verify no other bypass |
