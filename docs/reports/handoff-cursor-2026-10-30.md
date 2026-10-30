# Handoff and native cursor acceptance

## Behavior

Native session recovery keeps the confirmed receipt cursor. It sends only later messages. Rebuilt sessions receive chat text and retained summaries. They omit tool calls and results. Optional tool summaries retain at most 20 records, each at most 120 characters. Full records remain available through conversation_read.

The sanitized task 10902 baseline records a rebuilt session receiving an old process, window and snapshot token. The history regression checks that these tool records stay out of the handoff. Chat text can still contain historical identifiers.

The work computer selects a native cursor theme from the Bot avatar color. The source asset comes from Cua 0.37.0. Its manifest retains the source license and author. Recoloring preserves native shapes, motion, semantic states and the existing soft glow. Cua owns cursor sessions, position and visibility.

## Verification

- Focused Harness and computer regressions: 97 passed.
- Windows native input test: 1 passed in 19.2 seconds. The test reads back real control input and button actions. It checks two Bot colors and an explicit native cursor session. Theme checks wait for native rendering to apply the setting.
- Native theme preview: checked the arrow color, white edge and same-color soft glow.
- Desktop build and typecheck: passed.
- Lint: passed with eight existing warnings in web model, style and workspace test files.
- Diff whitespace check: passed.

These checks do not call an online model. The music task was not rerun. They do not establish a task speed or success-rate improvement. Linux and macOS native cursor rendering were not tested locally.
