# Browser Use

The client, Domos service computer, and Bot work computer have separate roles. The browser runs on the Bot's bound work computer. A remote viewer does not move the browser to the client.

## Execution

Each Harness calls the shared `ComputerTools` entry point. `ComputerServices` checks task ownership and user control. The work process calls the browser service, which owns an `agent-browser` MCP client. Chrome uses the Bot workspace's `.domos/browser` profile and `downloads` directory.

Ordinary mutations and Jev actions use the same Domos approval channel. The Bot's `ask` or `auto` setting controls approval. Missing approval channels deny mutations. An explicit allowlist permits page observations. Arbitrary JavaScript, navigation, tab changes, close, and restart require approval.

The browser service serializes the complete operation, including screenshot metadata lookup. Cancellation prevents queued actions from starting. Once an action reaches the browser, Domos waits for its response. Cancellation does not close Chrome. A takeover waits for that work to finish before it permits human input.

## Control and recovery

A headed browser shares control with the desktop on its work computer. The worker reports whether the browser is headless. Until that report arrives, Domos uses shared control. Each confirmed headless Bot browser has separate control. This is an application coordination rule, not operating system isolation.

Human input needs a current viewer lease. The browser acknowledges keyboard and mouse commands before Domos returns control. A pointer gesture is submitted on button release. Mouse coordinates become integer CSS pixels at the browser boundary. Another viewer cannot use the lease. Disconnection releases it after submitted input finishes. Cleanup of a stale viewer does not start another work process.

Before a mutation, the browser service writes `.domos/browser-interrupted`. A confirmed response clears it. A lost transport response, native `outcome_unknown`, or CDP command timeout keeps it. A new work process reads the same marker. Preparing a browser or taking a screenshot does not clear it.

While an outcome is unknown, Domos permits bounded observations. It blocks more browser mutations, user input, takeover, and desktop actions on the same display. The error identifies `agent_browser_restart` as the recovery action. This approved management tool also remains available in Jev mode. Restart closes this Bot's tabs and loses unsaved input. It waits for the old daemon to exit before reconnecting the native MCP client. Saved profile data remains. Inspect the external task result before retrying a submission. Restart does not prove that an external operation failed.

## Human takeover

Open the Bot work computer and select Browser. Select Take over. The workspace expands after control is confirmed. Click a page field, then type. Use the normal selection, arrow, delete, Tab, Escape, and Enter keys. Paste sends plain text to the selected page field. Shift+Escape returns focus to the toolbar. Return control when finished. The Bot must observe the page again.

The address bar shows the active page URL. It stays visible while watching and becomes editable during control. The optional text form opens from Input text. It inserts at the remote selection. It does not choose a field or replace its contents by itself. A confirmed command clears this form. A failed command keeps its draft. The viewer does not claim that a command response proves the page value.

The viewer maps the displayed image to page CSS pixels. Chrome can report window height while the image contains only the page. Use the depicted page ratio to correct that mismatch. Exclude image letterboxing. Reject input while the matching image is still loading. Desktop coordinates retain their reported screen dimensions.

Text input uses a focused textarea over the viewport. Composition stays local until it ends. Normal input and paste send text once. Special keys use atomic native presses, so the viewer does not leave modifier keys held. Pointer movements support hover. A drag keeps a bounded path and submits it on release. Cancellation, focus loss, and hand-back discard an unfinished gesture. This avoids holding a remote mouse button across a lost client connection.

Each connection has one bounded input queue. Consecutive pointer moves coalesce. A failed command or a full queue stops further input. Frame acknowledgements use a separate path so observation can continue. Hand-back remains available. Reconnect releases the old lease before opening a new view. It preserves the local draft and does not replay it. If the native service reports an unknown outcome, its restart requirement still applies.

The work view uses a compact toolbar and the existing UI tokens. The page is the main surface. Profile editing stays in the Bot tab. Controls in one row share a height. Accessible names remain on controls; decorative labels and duplicate descriptions do not belong in the toolbar.

## Results and tool boundary

An action response, an observation, saved evidence, and completion of the user's task are separate results. If screenshot metadata or evidence storage fails, Domos keeps the native action response and adds a text notice. Recover the observation or storage. Do not replay the action.

Jev can verify a browser control by exact role and accessible label. Optional value and selection conditions use live DOM values. Two observations must match on the same URL. Duplicate matches and unsupported control semantics do not confirm completion. This verifies the supplied control condition, not the complete user task. Frames and shadow roots require a separate supported observation.

Domos owns session, launch, profile, restore, certificate, and screenshot storage options. The tool catalog hides these options. Execution rejects hidden and unknown argument names. Native output schemas remain intact. Page text has a 32,000-character budget. Large text results ask the caller to use a narrower scope. Screenshots keep their native image content.

## Local and remote setup

The same execution rules apply to native work computers, spare computers, and VPS work computers. The selected work image must contain a browser. A headed Linux browser also needs a graphical session. The application service image and the work image have separate jobs.

The Add Docker Computer form exposes three network policies:

| Policy | Requirement | Result |
| --- | --- | --- |
| `none` | None | External networking is disabled. Local browser pages still work. |
| `web` | A proxy image on the selected Docker host | HTTP(S) proxy access, with internal addresses blocked. |
| `restricted` | Domos egress firewall rules on the selected Linux host | Restricted public egress. |

The form sends the chosen policy for both local and SSH Docker hosts. Local image preparation can supply the proxy image. Remote hosts need that image too. Browser readiness and network policy appear separately in the work view. The policy does not prove that a particular site is reachable.

## Verification

See [Computer Use evals](computer-evals.md). `browser-failures.json` contains the sanitized Windows baseline. Runtime tests check cancellation, unknown outcomes, parameter ownership, and result preservation. Control tests check approval and shared display ownership. Native tests read back form input after takeover, preserve profiles across restart, and reproduce a response timeout followed by a late page mutation.

The Checks workflow runs these tests on Windows, Linux, and macOS and saves JUnit output. Computer effects also runs the shared control tests. These checks do not measure online model success rates.

The installed adapter targets `agent-browser` 0.39.1. Configuration and command behavior were checked against the [official configuration reference](https://agent-browser.dev/configuration) and [command reference](https://agent-browser.dev/commands). Memoh informs the compact tool boundary. OpenMausBot informs uncertain-state recovery. openbot informs draining and input readback. rakazo informs shared screen ownership.

Viewer protocol details were checked against the current [agent-browser streaming reference](https://agent-browser.dev/streaming) and [command reference](https://agent-browser.dev/commands). The stream supplies frame IDs and URL messages. Its input delivery does not acknowledge browser execution, so Domos keeps the native command result path. Text handling follows the documented [compositionend event](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event), [input event](https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event), and [wheel units](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode). OpenMausBot informs coordinate calibration and queue handling. openbot informs direct page interaction. rakazo informs screen priority and confirmed control state.
