# Harness context

## Ownership and admission

Domos stores Bot identity, complete chat, memories, attachments, and computer permissions. Pi Durable 1.4.0 stores submissions and tasks. Runtime.submit admits ordinary chat, additional input, routines, API requests, and CLI requests. Stable request IDs deduplicate retries.

The selected native Harness runs on the Bot's work computer. It owns generation, model context, and native tools. The driver registry includes Pi RPC, Codex app-server, Claude Code stream JSON, OpenCode ACP, and custom ACP. UI choices come from the registry. Models and thinking levels come from the selected native program.

Custom ACP uses the stable v1 SDK. The administrator supplies a program and arguments. Config options expose native model and thinking selectors. The adapter supplies the Domos MCP endpoint. Each additional Harness needs a compatibility check before it is listed as supported. Draft ACP v2 is not enabled.

## Programs and accounts

Discovery resolves the program on the work computer. Inspection, login, and execution use that path and OS user. Existing native account files remain authoritative. Domos does not copy retained service credentials into native account files.

Absolute paths use filesystem checks. Windows selects an executable or command shim. POSIX checks execution permission and resolves login-shell commands. Missing programs, permission failures, and discovery failures remain distinct. Connection snapshots and persisted model catalogs serve the selector. Opening it retains the snapshot and refreshes in the background. Concurrent checks share an active request. Failed discovery is not cached as an installation result.

Downloads install a pinned package in the work computer's runtime directory. Node and npm must be available there. Existing installations stay in place. Installing an independent version does not activate it. Saving the selected model activates the resolved program. Configuration changes require an idle Bot.

Pi login uses its native ModelRuntime through an RPC extension. Codex and Claude use native login commands. OpenCode uses its local account API. Account state and secret input are transient. The native program stores credentials. Administrators manage programs and accounts. Paired clients can select available models in the Bot's configured Harness.

## History and migration

The forward migration keeps the current database. It sets migrated Bots to Pi and retains the current provider/model and thinking level. It settles old work and saves drafts as stopped messages. Missing native configuration requires user action. Migration does not silently select another model.

Switching Harness or work computer creates a native session. The display history remains continuous. Native session keys include the computer, configuration, and native account fingerprint. Native recovery checks recorded outcomes before deciding that a turn completed. Uncertain work is not sent again.

Handoffs contain quoted recent history. They scan up to 64 entries. Each text excerpt has a 4000-byte limit. The packet has a 16000-byte limit and may shrink to fit the native context budget. JSON escaping and metadata count toward the limit. UTF-8 characters stay intact. Historical images and private reasoning do not enter the handoff.

The conversation_read tool reads the complete stored record:

- `{}` reads a recent page. Pass its `from` cursor as `before` for older entries.
- `{ "entryId": 123, "offset": 0 }` reads a record in UTF-8 chunks. Follow `nextOffset` until null.

Each read belongs to the current Bot. File references retain their work computer identity. Native recovery reads are bounded separately. The original native session and Domos evidence remain on disk.

## Tools and display

Product tools call existing Domos services through durable ToolTask records. Native permission requests use the shared ComputerRuntime approval callback. Browser and desktop actions use the existing computer service, control leases, takeover cards, and evidence storage. See [Browser Use](browser-use.md).

Pi file and command tools use the shipped approval extension. Claude uses its permission tool callback. Codex and ACP use protocol permission requests. Cancellation closes pending approvals. A successful tool call does not prove the user task completed.

Pi registers Domos product tools directly through its extension API. User MCP extensions and account files remain intact. Each new or recovered task waits for the native session to read the Domos gateway catalog. Codex also checks its MCP tool catalog. Claude waits for a terminal connection state and checks tool names. ACP requires HTTP MCP capability. A failed check stops dispatch before the model receives the task.

Native Harness processes own compaction. Domos records context readings, compaction events, and reported usage. Unsupported values stay unknown. Custom ACP recovery is unavailable until its driver can verify native outcomes. Domos does not infer cost or completion from a missing event.

System instructions stay stable across tool rounds. routine_list supplies current host time and timezone. The UI reads complete stored entries. Handoffs and compaction records stay out of displayed messages. Current tool evidence retains the existing computer observation limits. Native CLI context policies are not the embedded Durable beforeRequest image policy.

## Verification

Protocol tests cover native model controls, permission requests, and custom ACP setup. Lifecycle tests cover additional input and cancellation. Recovery tests cover uncertain dispatch and forward migration. History tests cover byte budgets and Bot isolation. Browser E2E checks include real input and result readback. See [Computer Use evals](computer-evals.md).

`DOMOS_NATIVE_SMOKE=1 pnpm test packages/agent/test/harness-native.test.ts` uses native accounts on the current work computer. It calls a Domos tool, reads the desktop window list, and checks a fresh response marker. It incurs model usage. It does not perform desktop input. The test requires an interactive desktop and installed, authenticated CLIs. Set `DOMOS_NATIVE_<HARNESS>_MODEL` to select a model. Cross-platform protocol and resolver tests run in Checks. They do not prove native CLI login or OS permissions on every system. See the [2026-10-29 acceptance report](reports/harness-readiness-2026-10-29.md).

## Official references

Checked against installed packages and current official documentation on 2026-10-29.

- [Pi RPC](https://pi.dev/docs/latest/rpc) and [extensions](https://pi.dev/docs/latest/extensions).
- [Pi MCP extension ownership](https://pi.dev/docs/latest/mcp).
- [Codex app-server](https://developers.openai.com/codex/app-server).
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference).
- [Claude Agent SDK MCP status](https://code.claude.com/docs/en/agent-sdk/mcp).
- [OpenCode ACP](https://opencode.ai/docs/acp/) and [server](https://opencode.ai/docs/server/).
- [ACP v1 configuration options](https://agentclientprotocol.com/protocol/v1/session-config-options).
- [ACP v1 MCP capabilities](https://agentclientprotocol.com/protocol/v1/session-setup).
