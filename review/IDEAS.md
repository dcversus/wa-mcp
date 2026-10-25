
## Parity matrix gaps — post-0.1.0 candidates (2026-10-04 orchestrator sweep)
- pin chat / pin message (kahflane, lharries) — not in GOAL 0.9
- star/save message — not in GOAL 0.9
- mute/unmute chat — read-side mute status exists (line 120); setter absent
- archive/unarchive chat — archived flag in list_chats exists; setter absent
- set_typing as standalone tool — set_chat_state covers composing/recording
- disappearing-mode setter per chat (read-side tracking landed T80)
