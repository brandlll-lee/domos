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

The details panel keeps one fixed identity header and three tabs: Bot, Computer, and Browser. Computer shows the desktop. Browser shows the Bot's native Chrome window, including its address bar and tabs. Both use the same headed browser and shared display control.

Click the screen to take control. The first click only requests control. It does not reach the remote screen. Click a field, then type, paste, select, or scroll. Shift+Escape returns focus to the toolbar. Return control when finished. Takeover keeps the panel size. The Bot must observe the page again.

The browser service reads its own profile's DevTools endpoint. CDP identifies the browser PID. Cua binds one visible window from that PID. An ambiguous or unavailable window stops the connection. Browser viewing requires a headed browser and a graphical session. Headless browser tools still work without this viewer.

Cua captures the selected window and executes input against that window in the same session. The viewer maps the displayed image to the reported screenshot coordinates. It excludes letterboxing and rejects input while the matching image loads. Human window drags use foreground delivery. Other native inputs first use background delivery. A driver result of `background_unavailable` means delivery did not occur. Only this explicit refusal permits a foreground retry. Other failed or uncertain results stop input.

Page hover uses the owned browser's CDP input route. It reads live window and page dimensions. The mapping assumes standard Chrome borders. Side-panel layouts need native viewport bounds before they can use the same calibration.

Text input uses a focused textarea over the viewport. Composition stays local until it ends. Normal input and paste send text once. Special keys use atomic native presses. Pointer movements support hover. A drag submits its start and end on release. Cancellation, focus loss, and hand-back discard an unfinished gesture.

Each connection has one bounded input queue. Consecutive pointer moves coalesce. A failed command or a full queue stops input. Frame acknowledgements use a separate path. Hand-back remains available. Reconnect releases the old lease and does not replay input. Native unknown outcomes retain the browser restart requirement.

The screen fits the available area and keeps its aspect ratio. The bottom toolbar stays visible. It contains connection state, return control, panel expansion, settings, and fullscreen. Fullscreen uses the platform Fullscreen API. It hides the app shell and desktop title bar. Escape exits locally. It does not reach the remote browser. Exiting restores the panel and control state. Electron grants fullscreen only to the trusted Domos main frame.

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

The form sends the chosen policy for both local and SSH Docker hosts. Local image preparation can supply the proxy image. Remote hosts need that image too. Computer settings show browser readiness and network policy. The policy does not prove that a particular site is reachable.

## Verification

See [Computer Use evals](computer-evals.md). `browser-failures.json` contains the sanitized Windows baseline. Runtime tests check cancellation, unknown outcomes, parameter ownership, and result preservation. Control tests check approval and shared display ownership. Native tests read back form input after takeover, preserve profiles across restart, and reproduce a response timeout followed by a late page mutation.

The Checks workflow runs these tests on Windows, Linux, and macOS and saves JUnit output. Computer effects also runs the shared control tests. These checks do not measure online model success rates.

The installed adapter targets `agent-browser` 0.39.1. Configuration and command behavior were checked against the [official configuration reference](https://agent-browser.dev/configuration) and [command reference](https://agent-browser.dev/commands). Memoh informs the compact tool boundary. OpenMausBot informs uncertain-state recovery. openbot informs draining and input readback. rakazo informs shared screen ownership.

Native capture and delivery follow the [Cua MCP tools reference](https://cua.ai/docs/cua-driver/reference/mcp-tools). Browser identity uses [CDP SystemInfo](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/). Fullscreen follows the [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) and [Electron session permissions](https://www.electronjs.org/docs/latest/api/session). Text handling follows the [compositionend event](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event), [input event](https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event), and [wheel units](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode).
