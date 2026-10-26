# Browser takeover verification

## Scope

This change covers viewer identity during handoff, Windows native MCP startup, bounded page observations, action batches, and chat-card acceptance. It preserves persistent profiles and stored user data.

## Saved failure

The reviewed task took 253.147 seconds. The handoff card appeared after 176.671 seconds. Its handoff tool took 45.970 seconds, including human interaction and connection work. The final response followed 30.805 seconds after that tool returned. There were 13 tool calls and 14 model responses. Three browser calls took 29.728, 29.132 and 28.571 seconds. Tool timestamps do not separate browser execution from transport. No per-input latency was recorded in that task.

An event-gated regression failed on both Browser and Computer before the fix. During the grant, the same viewer received the other-window conflict. The regression uses real shared services and a controlled work-process boundary. It does not prove the exact event order in the historical task.

## Native MCP version comparison

Both versions ran on the same Windows computer and system Chrome. Each attempt used a new temporary profile and socket directory. The first command was `agent_browser_tab_list`, without a prior prepare command. The test guarded each MCP response at 10 seconds. It closed only its own browser session. It did not use a model or a public website.

| Version | First reply, attempt 1 | Attempt 2 | Attempt 3 |
| --- | --- | --- | --- |
| 0.39.1 | No reply before 10,014 ms guard | No reply before 10,003 ms guard | No reply before 10,004 ms guard |
| 0.39.4 | 833 ms | 914 ms | 767 ms |

With 0.39.4, the following local navigation took 119–200 ms. A compact snapshot took 52–55 ms. These numbers isolate the native MCP startup defect. They do not establish a speedup for the complete historical Agent task or all three long calls.

The versioned [MCP implementation](https://github.com/vercel-labs/agent-browser/blob/v0.39.4/cli/src/mcp.rs), [release notes](https://github.com/vercel-labs/agent-browser/releases/tag/v0.39.4), and [Windows output capture repair](https://github.com/vercel-labs/agent-browser/pull/2160) were checked on 2026-10-26. Exa and Tavily searches found the official references. A Browser Use MCP connector was not available. Playwright checks used the real browser instead.

## Acceptance evidence

The first focused chat-card run passed both direct and refreshed-page flows. Each used one takeover click and had zero false conflicts. Grant time was 282–295 ms. Input-to-paint was 171–180 ms, including test polling. The scripted Harness opened the page, requested takeover and read back the changed value after completion. This is deterministic integration evidence. It does not measure online model performance.

The native page tests read back a completed fill-and-click batch. Blank, loading-message and error-content fixtures report their actual URL, title, text and document readiness. They do not infer why content is missing. Mocked regressions cover observation failure, partial batches, uncertain delivery and repeated unchanged actions.

Current runs save raw measurements and screenshots under `test-results/`. The Checks workflow uploads them by operating system. Local Windows results do not establish Linux, macOS, remote desktop or cloud acceptance. No remote CI result is implied before a push.

## Review repairs

Large page facts could consume the tool text limit and hide fresh element refs. A failing regression proved this case. Page facts now have a separate 12,000-character display limit. The native action result stays intact.

The upgraded native runtime can return `page_wedged` after a page stops responding. A failing regression showed that the service allowed another mutation. This code now preserves the interrupted marker and blocks mutations until explicit recovery.

The work image still pinned the old browser version. Its build context also lacked imported browser modules. The image now installs the same browser version and its schema dependency. Both work-image sources include the browser modules. The desktop runtime test imports the copied tools and checks tool discovery.

The first complete unit run passed 383 tests and failed one Windows process-cleanup timeout while the web suite ran at the same time. The next unit run passed all 384 tests. After the review repairs, the final unit run passed 386 tests and skipped 34 environment-dependent tests.

The first complete web run passed 84 tests. One existing layout test failed during resize. It sampled the parent and child rectangles in separate browser calls. Its focused rerun passed. The test now reads both rectangles in one browser call and keeps the same geometry limits.

## Final verification

The final complete web run passed all 85 tests in 6.7 minutes. Both first-click flows passed. Their grant times were 201–306 ms and input-to-paint times were 156–178 ms. The final complete unit run passed 386 tests in 57.8 seconds. It skipped 34 environment-dependent tests. Its cold browser reply took 3,194 ms while the full unit suite ran. This differs from the isolated version comparison and shows why runner load must be reported.

Type checking and lint passed. Lint retained eight existing warnings. The desktop build completed. The built runtime test passed in 9.8 seconds. It started the packaged worker and found the native desktop tools and shared browser tools. The work context imported its copied tool module.

## Final review

What this change does: It keeps the current viewer attached while control changes. It returns bounded page facts after known actions and preserves uncertain outcomes.

Looks good. Ship.

Checked: Shared approval and control callers, frame acknowledgement, grant failure and close, native result schemas, partial batches, restart recovery, output limits, copied runtime imports, and complete chat handoff. The assumed load is one service with concurrent Bots and viewers on a work computer. No new framework or unused compatibility path was added.

Not checked: Online model task success, Linux and macOS native sessions, remote computers, cloud latency, and remote CI. Docker was unavailable on this computer, so the updated work image was not built locally. The existing sandbox CI job remains its build and execution check.
