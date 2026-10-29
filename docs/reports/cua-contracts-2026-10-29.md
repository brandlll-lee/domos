# CUA contract acceptance — 2026-10-29

Scope: saved native catalogs, model observations, and shared desktop action recovery. No model loop or account configuration changed.

## Baseline and implementation

The shared-entry probe lost native outputSchema and annotations. A script bypassed an uncertain-action guard. Script cursor tracking retained the previous click. The sanitized cases are in [cua-contracts.json](../../packages/agent/test/fixtures/cua-contracts.json).

The gateway now uses the saved callable catalog and supplements structured results with text. Images and strict structured output remain intact. Pi stores the original result in details. Direct actions, batches and scripts share mutation classification and observation recovery. Scripts require independent observation. Effects read native script cursor state. Repeated screenshots retain current metadata.

Before the change, real Pi and OpenCode sessions read the image marker but missed structured-only fields. The installed Codex session read both. The ordinary Codex source path does not describe every installed session path; no Codex-specific conversion was added.

## Verification

- Full unit suite: 339 passed, 40 skipped; 62.03 seconds. Log: `test-results/cua-contracts-unit.log`.
- Desktop E2E: 7 passed; 34.1 seconds. Native input, script input, strict native output validation and readback passed. Log: `test-results/cua-contracts-desktop.log`.
- Typecheck passed. Lint passed with eight retained warnings. Desktop build passed.
- Real model probes passed image-only and structured-only markers, coordinates and verified=false through Pi, Codex and Claude. OpenCode passed an earlier post-change run, but its final repeat failed with Insufficient Balance. Custom ACP with OpenCode remains unaccepted: account/provider requests returned Insufficient Balance or Forbidden; another provider timed out.
- These probes require one tool call per model. They do not measure music-task completion, model speed or success-rate improvement. Native in-flight script cancellation and cross-window script effects were not separately accepted.
- Checks now includes shared contract regressions. Remote CI was not run. Windows desktop results do not establish Linux/macOS permissions or arbitrary ACP compatibility.

## Official sources

- [MCP tools and structured output](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): preserve schemas and provide text for content-based clients.
- [Pi extensions](https://pi.dev/docs/latest/extensions): model content and retained details have separate roles.
- [Codex 0.163.0 result conversion](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/protocol/src/models.rs): pinned source; installed-session acceptance takes precedence over a general inference.
- [CUA batches and scripts](https://cua.ai/docs/cua-driver/reference/mcp-tools/batch-recording-and-settings) and [native cursor](https://cua.ai/docs/cua-driver/reference/mcp-tools/pointer-cursor-and-browser): use native execution and cursor contracts.
