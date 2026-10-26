# Browser Use review

What this change does: Browser actions use shared approval and control ownership. Cancellation preserves the browser. Unknown outcomes pause further changes until an approved restart.

## Scope

The review covers the shared tool entry, Harness execution, browser worker, viewer input, evidence storage, Jev verification, Docker setup, and their callers. It assumes the existing single Domos service owns a work computer. Multiple Bots can share its desktop. This control state does not isolate arbitrary shell commands or separate Domos service installations.

## Checks

- Approval denial sends no browser action. Missing approval also denies mutations.
- Queued cancellation sends no action. Dispatched actions drain before takeover.
- Unknown native, CDP, and transport results preserve a recovery marker across work process reloads.
- Browser and desktop control share ownership unless the worker confirms a headless browser.
- Human input waits for a native response. Returning control waits for input. A stale release cannot clear a later takeover.
- Screenshot metadata and evidence storage errors retain the action result. Strict native output keeps added status in text.
- The catalog hides runtime arguments. Execution rejects hidden arguments. Native structured output remains intact.
- Jev checks a unique DOM control twice. A mismatched value does not pass.
- The remote Docker form sends the selected network and proxy settings. Browser readiness appears separately from network policy.

## Evidence

Windows, Node 24.22.1, agent-browser 0.39.1, 2026-10-26:

- Full suite: 342 passed, 34 skipped, 53.33 seconds. The final concurrent-release regression also passed in the focused control suite: 11 passed.
- Type check passed. Lint passed with eight existing warnings.
- Three affected web tests passed. The tests cover network setup, viewer takeover and reconnect, and connection retry. Desktop and narrow-screen screenshots were inspected.
- Native browser tests read back text and button changes after takeover. They retain profile data across service restart. A 35-second page mutation reproduces a native response timeout and confirms that later changes stay blocked until explicit restart.
- One focused run hit the existing API stream-disconnect timing failure. The isolated test and the following full suite passed. Cross-platform CI runs the same regression.

The review found and corrected native mouse coordinate rejection, restart reconnection failure, stale-view worker recreation, strict-schema evidence augmentation, and stale release ownership. The first CI run also found that the macOS per-user temp path exceeded the native Unix socket limit. macOS now uses a private session directory under `/tmp`. Native CI tests cover long workspace paths. Windows cleanup exceeded the hook guard after catalog discovery. Cleanup now checks for the native daemon before issuing a close command. A unit regression covers discovery with no running browser. No additional dependency or alternate browser engine was added.

Looks good. Ship.

Follow-up CI review found a macOS restart race after the close command returned. Restart now waits for the previous daemon to exit before it reconnects. If graceful exit stalls, the existing stop path checks executable identity and process ownership first. A regression holds the old daemon alive and checks that reconnection waits. The native late-effect regression also passes on Windows after this change.

Not checked: online model task success, third-party site reachability, and production host permissions. Cross-platform and container results must come from CI for the final commit. An explicit browser restart closes tabs and loses unsaved input.

## Human takeover review

What this change does: Users select takeover, click the page image, and type into the real browser. The workspace expands after control is confirmed. Failed input stops the queue and keeps the text draft.

The review follows the web viewer, RPC validation, work computer binding, shared control lease, browser commands, desktop gesture handling, and test server. It assumes one service owns each work computer. Each viewer has a bounded queue. The existing service controls access when several viewers use the same work computer.

The final pass found no open must-fix or should-fix items. It checked these cases:

- Page coordinates follow the decoded image. Desktop coordinates keep their screen dimensions. Image margins reject clicks.
- Chinese composition stays local until commit. Paste sends plain text. Special keys use complete native presses.
- Pointer cancellation discards the buffered gesture. A late release cannot create a desktop click.
- Failed input blocks later mutations. Acknowledgements still allow new frames. Drafts survive reconnect and require an explicit retry.
- Reconnect waits for the old control lease to end. A frame acknowledgement cannot overwrite takeover state.
- The expanded image fits the available height. Address and text controls align with their buttons. Profile editing stays in the Bot tab.

Review corrections included the reconnect lease order, frame acknowledgement state, expanded image height, and auxiliary input alignment. Cleanup removed the previous height overrides and the old inline input handlers. No dependency was added.

The reference code informed the design. OpenMausBot supplied image calibration, wheel units, and focus handling. openbot supplied direct page interaction. rakazo supplied screen priority and control ownership. Domos keeps its existing authenticated command path because stream input does not acknowledge execution. Current official API links are in [browser-use.md](browser-use.md) and [computer-evals.md](computer-evals.md).

Windows verification used Node 24 and the installed agent-browser. The full unit suite passed 361 tests and skipped 34 tests in 52.02 seconds. The native takeover flow and failure recovery passed twice each in 30.7 seconds. Readback came from the real test page. No script focused a remote field. Screenshots at widths 1440, 768, and 390 were inspected. Type check passed. Lint passed with eight retained warnings. These tests do not call an online model.

The full web suite passed 81 tests in 6.0 minutes. It includes the existing computer viewer, draft retention, layout, chat, and account workflows. After the final auxiliary input alignment and unused attribute cleanup, a fresh build and both native takeover tests passed in 13.0 seconds.

Looks good. Ship.

Not checked: real operating-system IME candidate windows, Linux and macOS native behavior, remote work computers, and remote CI. Chromium composition was tested through its CDP input API. User data and open user pages were not used for tests. These local commits are not pushed.
