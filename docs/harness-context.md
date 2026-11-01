# Harness context

## Ownership and admission

Domos stores Bot identity, complete chat, memories, attachments, and computer permissions. Pi Durable 1.4.0 stores submissions and tasks. Runtime.submit admits ordinary chat, additional input, routines, API requests, and CLI requests. Stable request IDs deduplicate retries.

The selected native Harness runs on the Bot's work computer. It owns generation, model context, and native tools. The driver registry includes Pi RPC, Codex app-server, Claude Code stream JSON, OpenCode ACP, and custom ACP. UI choices come from the registry. Models and thinking levels come from the selected native program.

Custom ACP uses the stable v1 SDK. The administrator supplies a program and arguments. Config options expose native model and thinking selectors. The adapter supplies the Domos MCP endpoint. Each additional Harness needs a compatibility check before it is listed as supported. Draft ACP v2 is not enabled.

## Programs and accounts

Discovery resolves the program on the work computer. Inspection, login, and execution use that path and OS user. Existing native account files remain authoritative. Domos does not copy retained service credentials into native account files.

Absolute paths use filesystem checks. Windows selects an executable or command shim. POSIX checks execution permission and resolves login-shell commands. Missing programs, permission failures, and discovery failures remain distinct. Connection snapshots and persisted model catalogs serve the selector. Shared client state retains each Harness snapshot while a background check runs. Concurrent checks share an active request. Matching refreshes reuse the last result for three seconds. Failed discovery is not cached as an installation result.

Model and effort choices update the selector immediately. Saves run in order with the latest confirmed revision. A failed save restores the confirmed choice and reports the error. Chat dispatch waits for pending saves. Effort options come from the retained native model capabilities.

Claude model choices retain the CLI's selectable identifiers. Their labels include the native resolved model ID. Effort choices come from each entry's supported levels. Session controls match both the selectable identifier and the resolved ID. The native catalog determines which models are available.

First setup uses the saved configuration revision. A temporary readiness failure does not return a configured Bot to setup. Task dispatch still checks the work computer and native connection.

Downloads install a pinned package in the work computer's runtime directory. Node and npm must be available there. Existing installations stay in place. Installing an independent version does not activate it. Saving the selected model activates the resolved program. Configuration changes require an idle Bot.

Pi login uses its native ModelRuntime through an RPC extension. Codex and Claude use native login commands. OpenCode uses its local account API. Account state and secret input are transient. The native program stores credentials. Administrators manage programs and accounts. Paired clients can select available models in the Bot's configured Harness.

## History and migration

The forward migration keeps the current database. It sets migrated Bots to Pi and retains the current provider/model and thinking level. It settles old work and saves drafts as stopped messages. Missing native configuration requires user action. Migration does not silently select another model.

Switching Harness or work computer creates a native session. The display history remains continuous. Native session keys include the computer, configuration, and native account fingerprint. Native recovery checks recorded outcomes before deciding that a turn completed. Uncertain work is not sent again.

Handoffs contain quoted recent chat text and retained summaries. They scan up to 64 entries. Each text excerpt has a 4000-byte limit. The packet has a 16000-byte limit and may shrink to fit the native context budget. JSON escaping and metadata count toward the limit. UTF-8 characters stay intact. Historical images and private reasoning do not enter the handoff. Native recovery sends only messages after the confirmed receipt cursor. Rebuilt sessions omit tool calls and results. The shared history selector can include at most 20 tool summaries of 120 characters each. These summaries contain tool names and status, not arguments, window handles or result trees. Complete tool records remain available through conversation_read. Chat text can still mention historical identifiers; it is quoted history, not current execution state.

Native text, reasoning and tool records confirm receipt in the same accepted session, even when the turn later fails. The handoff cursor advances only through that confirmed range. Unconfirmed user input, stopped turns and terminal errors remain outside it. Compact operations retain their existing session boundary.

The conversation_read tool reads the complete stored record:

- `{}` reads a recent page. Pass its `from` cursor as `before` for older entries.
- `{ "entryId": 123, "offset": 0 }` reads a record in UTF-8 chunks. Follow `nextOffset` until null.

Each read belongs to the current Bot. File references retain their work computer identity. Native recovery reads are bounded separately. The original native session and Domos evidence remain on disk.

## Tools and display

Memory, messaging, skills, routines and file delivery use durable ToolTask records. Computer calls use the shared ComputerRuntime directly. A task-scoped call journal saves intent before dispatch and the complete result after settlement. A repeated call ID returns its saved result. An admitted call without a result is never replayed. Input validation, approval, takeover and evidence storage use the same module for native and Durable callers. Native permission requests use the shared ComputerRuntime approval callback. Browser and desktop actions use the existing computer service, control leases, takeover cards, and evidence storage. The desktop worker and Cua Driver runtime are shared by Bots on one bound work computer. Browser workers and profiles remain isolated per Bot. See [Browser Use](browser-use.md).

Pi file and command tools use the shipped approval extension. Claude uses its permission tool callback. Codex and ACP use protocol permission requests. Cancellation closes pending approvals. A successful tool call does not prove the user task completed.

Pi registers the product server with its native registerMcpServer API and direct exposure. Its subprocess loads native tool-search, the Domos approval extension, and native MCP explicitly. Native tool_search is active on session start and discovers configured MCP tools with deferred or codemode exposure. Product tools return images through native MCP content blocks. Automatic extension discovery is disabled for this subprocess. New work uses the session created at process startup. History recovery uses native session switching. Account and extension files stay intact. Each task waits for gateway discovery. Codex checks the native catalog. Claude checks terminal connection state and tool names. ACP requires HTTP MCP capability. Failed readiness stops dispatch. User extensions and account files remain intact.

Pi and Codex RPC errors retain the request name, execution phase, elapsed milliseconds, and native error message when supplied. A timeout states that no native response arrived. The handshake deadline remains 30 seconds. See [initialization acceptance](reports/harness-initialization-2026-10-30.md).

The gateway reads computer tools from the saved native catalog. Callable names still filter Bot access. Native output schemas, annotations and other tool metadata remain intact. The desktop relay forwards Cua's raw MCP result. Domos timing and platform metadata remain outside strict native structured output. Screenshots remain image content blocks.

The shared computer catalog exposes native actions, batches and scripts. It hides driver maintenance tools and the driver's browser tools when the Bot has its dedicated browser. Pi, Codex, Claude, OpenCode and ACP mount the same catalog. Only their native protocol configuration differs. The computer boundary reports the work environment and permissions. Shared computer instructions own target binding, delivery choice, waiting and outcome checks. Native schemas and get_guide define operation syntax. The Agent selects direct actions, batches or scripts. Window focus and action delivery mode remain separate. Snapshot controls must match the intended role and label. Incremental observations retain their scope.

Large text results use complete records within an 8000-character preview budget. Native structured results and original evidence remain intact. The gateway retains the latest 20 result payloads. A partial-result notice provides a handle, the result shape and an executable JMESPath example. The read-only query_result tool takes result and query. Its JMESPath expression selects nested records and fields from the complete value. Text-only JSON results are parsed for the same query path. Invalid expressions return an error with the shape and example. Queries do not dispatch the original tool. Expired handles require the saved work record. JSON previews remain parseable. Native tool result records retain the full payload.

Computer calls validate against the tool catalog prepared for the current turn. Intent and result journal commits retain replay protection. Text and reasoning drafts use a 300 ms flush interval. Tool and activity boundaries request a background flush. Each write updates changed messages by identity. Event delivery does not wait for display writes. Terminal handling drains pending writes. Native session and acceptance receipts still wait for storage. Harness receipt times are captured before queued event processing. The gateway preserves native image content in successful and failed results. It does not require a new observation merely because a tool failed.

Product-tool errors retain diagnostic text when structured output is empty or partial. Screenshot evidence stays in the task archive. Model notices contain the screenshot id and name. The Agent uses that id for requested image delivery. Evidence archive paths are not workspace paths. Once evidence confirms the user goal, the Agent reports the result and ends the turn.

Cua owns native sessions, delivery, verification and observation. The desktop relay forwards each Agent request once, with its original name and arguments. The Agent starts a session explicitly after an explicit end. Native errors remain tool results. Host permissions, takeover, cancellation and the intent/result journal remain outside native tool semantics.

Native Harness processes own compaction. Domos records context readings, compaction events, and reported usage. Unsupported values stay unknown. Custom ACP recovery is unavailable until its driver can verify native outcomes. Domos does not infer cost or completion from a missing event.

System instructions stay stable across tool rounds. routine_list supplies current host time and timezone. The UI reads stored history in pages of at most 200 messages. Entry cursors preserve order across pages. The live connection starts with one bounded snapshot. It then sends changed messages, runtime fields and removed pending records. Reconnecting retains loaded older pages. Tool results and inline images use authenticated single-record reads when displayed. Original evidence stays in storage. Work loads preceding pages when the selected execution crosses a page boundary. Handoffs and compaction records stay out of displayed messages. Current tool evidence retains the existing computer observation limits. Native CLI context policies are not the embedded Durable beforeRequest image policy.

## Work records

Work reads the existing EngineProjection, conversation records and EngineDoc. Native item IDs update existing rows. Live and recovered tools use the same adapter conversion. Recovery reads native history and never dispatches tools. Recovered fields without native timestamps remain unknown. Child records retain their native parent tool ID. Tool updates retain structured output and update time. Paged snapshots omit full output; the authenticated message endpoint reads it on demand. The shared Work dialog renders a timeline with native input, output, file changes and search queries. Native events supply text, exposed reasoning, tools, approvals, compaction, and Codex/ACP plans. Execution metadata retains the model, native ID, accepted additional inputs, and received times. Terminal metadata uses the existing conversation entries. Old records retain unknown fields. An ended run does not prove task completion. Stop revokes the active execution and terminates its native Harness process tree immediately. It settles inputs and Work records without waiting for native acknowledgement or Durable child cleanup. Late events cannot update another execution. MCP abandonment cancels the active call. Non-computer tools also cancel their owned ToolTask. Desktop observation and preflight requests have a 30-second deadline. Computer actions have a 120-second execution deadline. Approval waits retain their separate ten-minute deadline. Deadlines forward cancellation. Issued mutations retain their settlement path and control barrier. A stopped Agent can accept a new request while uncertain computer actions still require settlement.

The shared desktop boundary forwards the native tool catalog and structured results. Cua owns foreground delivery, tree cursors, and batch observation. Domos retains approvals, control leases, evidence, and unknown-result protection. A batch keeps its native end screenshot in the same request.

The intent/result journal retains original calls and prevents replay of an issued call with a missing result. Earlier-turn window, process and snapshot identifiers require fresh discovery. Cua sessions own cursor visibility, position, motion and rendering. The host selects an installed native theme from the current Bot avatar color. Theme assets preserve native geometry, semantic animations and soft glow. Themes compile once per source and color on the work computer. Appearance metadata stays outside Agent tool arguments. Native cursor timing honors reduced motion. Theme errors leave native action results unchanged.

See the [CUA lifecycle acceptance](reports/cua-lifecycle-2026-10-30.md) for current cancellation, native MCP, and Windows input checks.

See the [handoff and cursor acceptance](reports/handoff-cursor-2026-10-30.md) for history selection and native Bot cursor colors.

Protocol sources: [Pi RPC](https://pi.dev/docs/latest/rpc), [Codex app-server](https://developers.openai.com/codex/app-server), [Claude streaming](https://code.claude.com/docs/en/agent-sdk/streaming-output), [ACP plans](https://agentclientprotocol.com/protocol/v1/agent-plan). See the [acceptance report](reports/work-turns-2026-10-30.md).

## Messages and questions

Native assistant messages deliver updates and final results. Pi questions use extension UI select/input requests. Codex uses native user-input and elicitation requests. Claude uses AskUserQuestion. OpenCode and ACP use native interaction permissions or form elicitation. These requests use the shared stored question card. Answers and cancellation return through the originating native protocol. An unavailable native question capability must remain unavailable.

## Memory

Domos owns memory records. Each record belongs to one Bot unless the user shares it. User profile facts enter a fixed 8 KiB snapshot for one Durable task. Recovery and additional input reuse that snapshot. The next task reads current records. Work notes have a 24 KiB capacity and use memory_search or memory_list. Existing records remain work notes with their original text.

The memory tools are Domos product tools. Pi, Codex, Claude, OpenCode and ACP call the same storage and validation path through their existing native tool bridges. The model decides when to save. Tool descriptions set the profile/work rules. Memory text is data, not permission.

Background review is enabled by default. After ten successful user turns, Durable queues one task. It starts a separate native session and exposes only memory product tools with bounded recent history. It limits memory calls to 12 and stops after 120 seconds. It records native usage. It does not write review prompts or answers to displayed chat. The service rejects review edits to user-authored or shared entries. A new user turn cancels review. Users can disable review in the memory dialog. This task uses additional model calls.

## Verification

Desktop instruction regression on Windows, 2026-10-31: 67 tests passed. The boundary regression reproduced the duplicated policy before the fix. Native input passed. A temporary live Pi/deepseek-flash probe entered unique Chinese text and activated a button in a dedicated test window. Page readback matched. It used five model requests and four native calls in 11.357 seconds, including setup. The probe code was removed. The sanitized task 11030 baseline remains in cua-contracts.json. The music task was not rerun. This is not evidence of a speed gain or cross-platform desktop behavior.

Failure-recovery regression on Windows, 2026-10-30: 375 tests passed and 40 were skipped. Typecheck passed. Lint retained eight existing warnings. Tests cover empty and partial error output, failed Pi tool receipt, unconfirmed additional input and saved screenshot delivery. The sanitized `packages/agent/test/fixtures/pi-playlist-baseline.json` preserves task 10319: 94.334 seconds, 12 model responses and 11 tools. Its offline rules pass 2/3. The original incremental-scope failure remains in the fixture. This change has no new online CUA run or measured speed gain.

Protocol tests cover native model controls, permission requests, and custom ACP setup. Lifecycle tests cover additional input and cancellation. Recovery tests cover uncertain dispatch and forward migration. History tests cover byte budgets and Bot isolation. Browser E2E checks include real input and result readback. See [Computer Use evals](computer-evals.md).

Memory verification on Windows, 2026-10-29: 342 unit tests passed and 40 were skipped. The Bot panel E2E passed, including modal save, edit, Escape and focus return. Typecheck passed. Lint retained eight existing warnings. Native memory save/search passed on Pi, Claude, OpenCode and ACP with OpenCode. Codex reached memory-tool permission requests but did not finish within the 150-second test limit. Its live acceptance remains unverified. Other operating systems were not tested for this change.

`DOMOS_NATIVE_SMOKE=1 pnpm test packages/agent/test/harness-native.test.ts` runs real models through Pi, Codex, Claude, OpenCode and custom ACP with OpenCode. Models must save and search a Chinese response preference through test memory tools. They must return the search receipt, an image-only random marker, a structured-only marker, coordinates and `verified: false`. Cua captures the marker from a dedicated visible test window. Only its image reaches the model. Pi must call the observation tool directly. Set `DOMOS_NATIVE_<HARNESS>_MODEL` to select a model. This test incurs usage and requires installed, authenticated CLIs and an interactive desktop. It does not perform desktop input. Protocol tests do not establish OS permissions or universal ACP compatibility. See [readiness acceptance](reports/harness-readiness-2026-10-29.md) and [Pi desktop acceptance](reports/pi-cua-2026-10-30.md).

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
