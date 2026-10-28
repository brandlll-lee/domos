# Native Harness delivery

Date: 2026-10-28. Platform: Windows. Node: 24. pnpm: 10.20.0.

## Delivered behavior

- Pi, Codex, Claude Code, OpenCode, and custom ACP share the driver registry.
- The Bot's work computer owns native programs, accounts, and model execution.
- Existing native configuration takes priority. Downloads use a versioned runtime directory.
- Model choices and thinking levels come from the selected program.
- Native permission requests enter the shared approval service. Product tools retain existing computer control and evidence storage.
- Forward migration preserves displayed history, attachments, memory, and retained credentials.
- The UI reuses ModelSelector, SettingRow, TextField, Button, ChoicePicker, SearchPicker, Effort, and shared theme tokens.
- Obsolete managed-account pages, model hooks, and process-environment code were removed.

## Design sources

The local reference projects informed program discovery, installation, and driver registration:

- `references/OpenMausBot/server/harness/registry.ts`: driver registry and resolved CLI identity.
- `references/openbot/src/main/provider-detection.ts`: native discovery and configured providers.
- `references/openbot/scripts/runtime-install.ts` and `native-runtime.lock.json`: versioned runtime installation.

Domos keeps its existing work computer, tool, permission, and UI services. Protocol sources and versions are recorded in [Harness context](../harness-context.md).

## Verification

| Check | Result |
| --- | --- |
| Unit and integration suite | 335 passed; 38 skipped |
| TypeScript | Passed |
| Biome | Passed; 8 retained warnings in settings CSS and workspace tests |
| Desktop E2E | 7 passed |
| Web E2E | 82 passed in 7.3 minutes |
| Desktop build | Passed |
| Real Pi, Codex, Claude Code text turns | Passed |
| Real OpenCode text turn | Passed with native `deepseek/deepseek-flash` in 30.64 seconds |

The default OpenCode `big-pickle` request did not finish within 90 seconds. Another configured model returned a gateway/proxy 403. A model listed by the native `opencode models deepseek` command completed the same test. The user's default configuration was not changed. ACP startup, native model discovery, and permission protocol tests also passed.

The opt-in real CLI suite uses `DOMOS_NATIVE_SMOKE=1`. `DOMOS_NATIVE_<HARNESS>_MODEL` can select an explicit native model for a test. The tests deny tool approvals and request one short text response.

The 38 default skips include 4 opt-in real CLI tests. Protocol fixtures do not establish live service availability. Linux, macOS, Docker image execution, fresh native account sign-in, and additional third-party ACP programs were not accepted on this Windows run. Browser takeover E2E uses real input and result readback. No model-driven Computer Use success-rate claim is made.

## Local data

Before migration, SQLite quick_check returned `ok`. The backup contains 1 conversation and 7,736 entries.

Backup: `C:/Users/ASUS/AppData/Roaming/@domos/desktop/hosting/backups/agent-native-harness-20261028.sqlite`.

The backup uses SQLite's backup API. Native account files and the user's icon edit remain outside the commits.
