# Native browser acceptance

Browser actions now return native results. The Agent chooses observations, waits and native batch commands. The fixed repeated-action gate and Domos batch execution loop were removed. Domos retains approval, ownership, takeover, cancellation and the unknown-result barrier. Native partial batch results also set this barrier when they report an unknown outcome.

The shared catalog includes hover, drag, upload, download, frames, dialogs and conditional waits. Runtime and maintenance commands remain outside the published catalog. Pi uses native deferred MCP discovery. Codex disables its duplicate browser and computer features only in subprocesses that mount the corresponding Domos tools. User account files and global configuration remain intact. Cua actions, batches and scripts retain their native execution path.

## Evidence

The saved baseline had 76 passing driver tests. A new regression reproduced the fourth legitimate identical click being blocked. The sanitized case is in [browser-failures.json](../../packages/agent/test/fixtures/browser-failures.json). The new behavior dispatches all four calls and observes only on request.

- Browser, control, services, assistant, Harness protocol, MCP, context and eval regressions: 139 passed in 54.60 seconds.
- Harness process tests: 22 passed, 1 skipped. Real Pi startup exposed native deferred discovery and tool_search.
- Computer input contract tests: 11 passed. Native arguments, metadata, structured results and evidence retained their existing behavior.
- Real Codex model: passed in 42.863 seconds. Real Pi model: passed in 143.926 seconds. Both discovered tools, filled a local web form and submitted its exact random receipt to the HTTP fixture. The test also checked memory and image evidence. Recorded tool events include start and end events, so their count is not a call count. Model response rounds were not collected.
- The real browser test preserved native batch partial results and stopped at the selected `bail` condition. It uploaded a Files attachment, read back the selected filename, downloaded an HTTP attachment through native click and wait, published it through Files and rejected access from another Bot.
- Windows desktop acceptance: 2 passed in 25.2 seconds. It checked the packaged tool catalog and native Cua input, cursor, conditions, batches and scripts. It read back actual input and results.
- Typecheck and lint passed. Lint retained 7 existing warnings. The shell uses Node 22.22.2, which emits the repository's Node >=24 warning. The desktop tests use the packaged Electron runtime.

## Limits

No matched before-and-after model benchmark ran. These checks do not prove a performance or task-success-rate improvement. Claude, OpenCode and custom ACP have protocol coverage but no new real-model acceptance in this change. Linux, macOS, SSH and Docker were not accepted locally. No push means no new remote CI results.

Native agent-browser 0.39.4 `download(selector, path)` returned `Download was canceled` on this Windows host. Native click plus `wait_for_download` passed for the same HTTP attachment. A Windows path conversion in the upstream downloader is a possible cause, not a confirmed diagnosis. Domos does not add a replacement downloader or silently retry the action.

Sources: [versioned native MCP](https://github.com/vercel-labs/agent-browser/blob/v0.39.4/cli/src/mcp.rs), [native commands](https://agent-browser.dev/commands), [Pi native MCP](https://pi.dev/docs/latest/mcp), [Codex configuration](https://developers.openai.com/codex/config-reference).
