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

Not checked: online model task success, third-party site reachability, and production host permissions. Cross-platform and container results must come from CI for the final commit. An explicit browser restart closes tabs and loses unsaved input.
