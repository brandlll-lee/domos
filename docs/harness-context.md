# Harness context

## Ownership and delivery

Domos stores each Bot's chat history. A Harness owns its native session. A native session is scoped by work computer, Harness, account source, and account identity. Model changes reuse a compatible session. Switching A → B → A restores A's session and sends the newer history.

Each session stores a `through` entry ID. It records the point reached by delivery, not a copy of all text in the native context. History handoffs can contain excerpts. Native compaction can also change the retained context.

A new session starts with `through: null`. Creating a session does not confirm receipt of a prompt. A native checkpoint with `ready: false` does not advance the cursor. Confirmed prompt acceptance advances it to the submitted input. Successful completion advances it to the stored answer.

A rejected prompt or a cancellation before dispatch leaves the history pending. The next explicit request can carry it after a service restart. A failure after acceptance keeps the confirmed input cursor. The next request includes newer stored errors and results. Pi session selection stops when its native response reports `cancelled: true`.

Restart recovery checks the existing native operation. It does not send an uncertain operation again. A later explicit request can include that operation as quoted history. The prompt requires result verification before another action.

## Stored history and reads

History includes user and assistant text, selected material snapshots, tool arguments, linked tool results, errors, stop status, and file references. It also includes messages stored by the embedded Harness. File references retain their work computer identity. Historical images and private reasoning are not replayed as prompt content.

Automatic handoff scans up to 64 stored entries. It selects recent messages within the byte budget. Each message excerpt has a 4000-byte text limit. The complete serialized packet has a 16000-byte limit. JSON escaping and packet metadata count toward that limit. UTF-8 characters stay intact. `excerpt` marks clipped content. An empty page of internal entries retains a cursor for older reads.

The shared `conversation_read` tool provides two reads:

- `{}` reads recent history. Pass the returned `from` as `before` to read older entries. This cursor also works for empty pages that contain internal entries.
- `{ "entryId": 123, "offset": 0 }` reads one stored record. Follow `nextOffset` until it is `null`. Concatenate `text` chunks, then parse the result as JSON. Offsets count UTF-8 bytes in that serialized record. They must be character boundaries.

Record reads include the complete stored projection. They preserve long message tails and material snapshots. Each chunk carries at most 4000 bytes of text. Its response envelope remains below 16000 bytes. Records must belong to the current Bot. Invalid offsets and mixed cursor modes fail before a response is returned. Data already discarded before storage cannot be recovered by this tool.

## Target budget

Execution reads the latest context state after opening the target session. It uses a reading only when its Harness, native session, and configured model match. The configured model identifies aliases; the reading can retain the native model's full name. Old readings without this field require a matching model name.

Pi refreshes context during session opening. It uses `get_session_stats.contextUsage`, with the selected model's `contextWindow` as the window fallback. Other adapters use their existing native context events. A reading from the previous model cannot provide the new model's budget.

For a known window, shared execution subtracts:

- Reported context tokens. A `last-input` reading covers the previous input rather than the whole retained session. If the count is unknown for an existing session, the plan reserves half the window.
- An output planning reserve of one quarter of the window, capped at 8192 tokens.
- UTF-8 bytes for system instructions, the current request, and serialized tool definitions.
- The image-token estimate from the installed Pi AI library and a 1024-token protocol reserve.
- The handoff and current-request wrappers.

The remaining space limits the serialized history packet. Required input that exceeds the plan fails before dispatch. A history packet that cannot fit also fails. Stored chat records remain available.

This is an admission estimate. It is not an exact native tokenizer or an output limit setting. Text uses a conservative byte count. Images use the existing library estimate, so larger Base64 transport data does not itself consume more planned context tokens. Image costs, native system prompts, retained outputs, and native tools vary by engine. Native execution still owns final admission and compaction.

When the target does not expose a matching window, Domos caps the history packet at 16000 bytes. It does not infer a window from the model name or use the previous model's window. This path cannot guarantee that the entire native request fits. Native errors remain visible.

## Verification boundary

The sanitized cases in `packages/agent/test/fixtures/harness-context.json` record the original failures. `harness-context.test.ts` runs the shared execution and storage regressions. It covers failed and cancelled first handoffs across restart, complete record reads, Bot isolation, target budget changes, JSON escaping, UTF-8, and A → B → A. Four Harness variants exercise the shared budget path with controlled native readings.

`harness-recovery.test.ts` checks completed and uncertain operations across restart. The protocol and feature suites check the adapter frames, including Pi cancellation and context refresh. CI runs the context and recovery suites as a separate gate on Windows, Linux, and macOS. The remaining tests run once in the application gate.

These checks do not prove a live model's recall, native context fit, task success rate, or cross-platform desktop acceptance. Paid-provider validation must use the installed engine versions and a controlled Bot.

## Protocol sources

- [Pi 1.2.0 RPC commands](https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/rpc-commands.md): prompt acceptance, session cancellation, session statistics, and model objects.
- [Current Pi RPC commands](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md): current upstream contract.
- [Pi AI 1.2.0 context estimates](https://github.com/earendil-works/pi/blob/v1.2.0/packages/ai/src/utils/estimate.ts): the shared image-token estimate.
- [Codex App Server](https://developers.openai.com/codex/app-server/): native thread and turn recovery.
- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup): session loading and history replay.
