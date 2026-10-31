# Browser Use

The client, Domos service computer, and Bot work computer have separate roles. The browser runs on the Bot's bound work computer. A remote viewer does not move the browser to the client.

## Execution

Each Harness calls the shared `ComputerTools` entry point. `ComputerServices` checks task ownership and user control. The work process calls the browser service, which owns an `agent-browser` MCP client. Chrome uses the Bot workspace's `.domos/browser` profile and `downloads` directory.

Ordinary mutations and Jev actions use the same Domos approval channel. The Bot's `ask` or `auto` setting controls approval. Missing approval channels deny mutations. An explicit allowlist permits page observations. Arbitrary JavaScript, navigation, tab changes, close, and restart require approval.

The browser service serializes the complete operation, including screenshot metadata lookup. Cancellation prevents queued actions from starting. Once an action reaches the browser, Domos waits for its response. Cancellation does not close Chrome. A takeover waits for that work to finish before it permits human input.

`agent_browser_open`, click, fill, type, and press return a bounded observation after a successful action. `agent_browser_run_steps` accepts up to 24 known click, fill, type, or press steps. It validates the complete batch before dispatch. It stops at the first error and records completed steps and native results. It observes once at the end. Split a batch when the next action depends on a page transition.

Observation has one five-second native command budget. It reads the current URL, title, document readiness, bounded body text and non-password controls, then a compact snapshot. It keeps the native action's structured output and error status. Observation failure adds a warning; it never repeats the action. A transport failure during observation can retain the interrupted marker. Native timeout handling and output draining can exceed the follow-up budget; the budget is not a hard end-to-end deadline.

`agent_browser_observe` supplies the same read-only evidence after takeover or an unclear screenshot. Page text remains untrusted website data. A complete document does not prove that requested content loaded. Blank text does not identify its cause. Three identical successful actions with the same observed text and controls block a fourth repeat. Explicit observation or human input resets that guard. The guard does not prove that an external operation failed.

Tool text includes `Domos browser timing (ms)`. `queueMs` measures waiting before the serialized operation. `commandMs` measures native MCP action replies. `observationMs` measures follow-up native reads. `metadataMs` measures screenshot address lookup. `totalMs` includes local setup and validation. Client delivery and image decoding require separate viewer measurements. These values do not measure model response time or separate CDP work from MCP transport.

## Browser compatibility

The dedicated Agent browser starts headless unless the work environment explicitly selects headed mode. Computer settings show the active mode. The user can confirm a mode change there. The shared browser service restarts the same Bot browser with the same profile and downloads directory. It saves the choice in `.domos/browser-mode.json`. All Harness use this service. There are no website-name rules.

Switching closes tabs and unsaved page input. The confirmation states this cost. Saved cookies and local storage remain in the profile. Session-only page state is not guaranteed. End computer tasks and return control before switching. Domos closes browser viewers and reserves both browser and desktop control during restart. A headed browser then shares desktop control. A headless browser uses its own control. An explicit confirmed restart can also recover an interrupted browser; it does not prove that a previous submission failed.

Navigation returns the requested URL, observed URL, browser mode, available HTTP status, and access assessment in text content. A native failure remains a failure. Navigation failures also receive a bounded read-only observation. Domos does not replay navigation or submissions. HTTP 403 means access was denied; it does not identify the rejection rule. HTTP 401 indicates authentication. Password fields and challenge elements are page signals. They do not prove that a task needs login or that a challenge can be solved. Missing status remains unknown.

The user chooses whether to try another mode after inspecting this evidence. A mode change does not open a personal browser or silently choose another website. Browser takeover cards show the URL observed when the request was made, when available. The stored service, computer revision and viewer lease continue to bind the actual takeover target. The user may navigate during takeover; the Bot must observe fresh state after completion.

The implementation follows [agent-browser configuration](https://agent-browser.dev/configuration) and [persistent sessions](https://agent-browser.dev/sessions). HTTP status observation follows [Resource Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/responseStatus). An unavailable or zero status does not prove success. [Cloudflare challenge support](https://developers.cloudflare.com/cloudflare-challenges/reference/supported-browsers/) limits automated browser environments. Mode switching does not guarantee access.

## Control ownership

A headed browser shares control with the desktop on its work computer. The worker reports whether the browser is headless. Until that report arrives, Domos uses shared control. Each confirmed headless Bot browser has separate control. This is an application coordination rule, not operating system isolation.

Human input needs a current viewer lease. The viewer reserves its identity before takeover waits for old actions. Its frames and acknowledgements remain live during this grant. Input waits for the grant to finish. Concurrent take requests reuse that viewer's pending grant. Another viewer still receives a control conflict. Closing during a grant releases only that reservation after the grant settles, including failed grants.

The browser acknowledges keyboard and mouse commands before Domos returns control. Pointer presses, moves, and releases run as they arrive. Mouse coordinates become integer CSS pixels at the browser boundary. Another viewer cannot use the lease. Disconnection releases it after submitted input finishes. Cleanup of a stale viewer does not start another work process.

Before a mutation, the browser service writes `.domos/browser-interrupted`. A confirmed response clears it. A lost transport response, native `outcome_unknown`, native `page_wedged`, or CDP command timeout keeps it. A new work process reads the same marker. Preparing a browser or taking a screenshot does not clear it.

While an outcome is unknown, Domos permits bounded observations. It blocks more browser mutations, user input, takeover, and desktop actions on the same display. The error identifies `agent_browser_restart` as the recovery action. This approved management tool also remains available in Jev mode. Restart closes this Bot's tabs and loses unsaved input. It waits for the old daemon to exit before reconnecting the native MCP client. Saved profile data remains. Inspect the external task result before retrying a submission. Restart does not prove that an external operation failed.

## Human takeover

The details panel keeps one fixed identity header and four tabs: Bot, Computer, Browser, and Work. Computer shows the desktop. Browser shows the Bot's webpage through agent-browser streaming. It uses the same session and persistent profile as the Bot's browser tools. The default browser runs headless. An explicitly headed browser shares display control with Computer.

Click the screen to take control. The first click only requests control. It does not reach the remote screen. Click a field, then type, paste, select, or scroll. Shift+Escape returns focus to the toolbar. Return control when finished. Takeover keeps the panel size. The Bot must observe the page again.

The browser service connects to the session's loopback stream endpoint. Frame acknowledgements pace delivery. Browser viewing and input do not use desktop capture, screen recording permission, or native window discovery. The browser's address bar and tabs are not part of the viewport.

The viewer fits the decoded image and excludes letterboxing from input. Browser coordinates use CSS pixels. The decoded aspect ratio sets the visible height when screencast metadata includes browser chrome. Pointer moves retain the current held-button state. Browser commands acknowledge input before Domos returns control.

Text input uses a focused textarea over the viewport. Composition stays local until it ends. Normal input and paste send text once. Special keys use browser key presses. Pointer movements support hover. Dragging runs before button release. Cancellation, focus loss, close, and hand-back release held buttons outside the page controls.

Each connection has one bounded input queue. Consecutive pointer moves coalesce. Consecutive wheel events merge at the same position, in the same direction, with the same modifiers. Keys, clicks, direction changes, and hand-back retain their order. A failed command or a full queue stops input. Frame acknowledgements use a separate path. Hand-back remains available. Reconnect releases the old lease and does not replay input. Unknown browser outcomes retain the browser restart requirement.

The screen fits the available area and keeps its aspect ratio. The bottom toolbar stays visible. It contains connection state, return control, panel expansion, settings, and fullscreen. Fullscreen uses the platform Fullscreen API. It hides the app shell and desktop title bar. Escape exits locally. It does not reach the remote browser. Exiting restores the panel and control state. Electron grants fullscreen only to the trusted Domos main frame.

Panel open and close changes use [React View Transitions](https://react.dev/reference/react/ViewTransition). The chat layout changes once. A clipped snapshot animates the bounds with the existing 220 ms motion token. The old text snapshot does not cross-fade over the new text. New pointer or keyboard input [ends the active transition](https://developer.mozilla.org/en-US/docs/Web/API/Document/activeViewTransition). Controls remain live. [Base UI animation states](https://base-ui.com/react/handbook/animation) control panel entry and exit. Resize observation restores transcript position before paint. Reduced motion disables these animations. Panel resizing does not recreate the browser viewer. Closing the panel releases its viewer and lease; reopening creates a fresh connection.

## Chat takeover requests

All four Harness use `computer_request_takeover` with `service` and a short `reason`. The shared execution service posts a stored chat card and holds the tool call. The model does not supply the Bot, viewer, or computer identity. The card uses the same approval record as the running task. It shows the reason, a browser or desktop preview, and Take over / Done actions. Waiting cards survive a client refresh. A stopped or recovered task expires its waiting cards.

Take over opens the matching workspace and acquires a viewer lease for that request. Completion checks the live task, Bot, bound computer revision, service, and request-owned lease. The client drains its input queue. The server waits for dispatched input and releases held buttons before returning control. Only explicit completion resolves the waiting tool. The Agent must observe fresh state before it continues. Closing a panel or losing the connection leaves the request waiting. It does not finish the task. A stale card cannot finish another request or release another viewer's lease.

## Input transport and frame pacing

The adapter targets agent-browser 0.39.1. Human input uses its loopback `POST /api/command` relay. Domos verifies `session_info` before opening the stream and sends the loopback Origin header. Each reply must confirm success. The route is an internal versioned contract. It is not an exposed arbitrary command API. It removes CLI launches from each human input. Browser preparation and Agent tools keep their existing paths.

The stream requests a 30 FPS cap and keeps acknowledgement pacing. Slow acknowledgement round trips reduce the cap to 10 FPS. Browser preparation sets the native viewport to 1280 × 720 in both modes. Stream metadata and input use this viewport. Frames remain latest-only. A 30 FPS cap is not a measured end-to-end frame rate. JPEG quality remains the daemon's stream setting; this adapter does not change shared encoding during a session.

The relay contract was checked against the pinned [native HTTP handler](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/stream/http.rs) and [native input actions](https://github.com/vercel-labs/agent-browser/blob/v0.39.1/cli/src/native/actions.rs). Frame pacing follows the current [streaming reference](https://agent-browser.dev/streaming).

## Results and tool boundary

An action response, an observation, saved evidence, and completion of the user's task are separate results. If screenshot metadata or evidence storage fails, Domos keeps the native action response and adds a text notice. Recover the observation or storage. Do not replay the action.

Jev can verify a browser control by exact role and accessible label. Optional value and selection conditions use live DOM values. Two observations must match on the same URL. Duplicate matches and unsupported control semantics do not confirm completion. This verifies the supplied control condition, not the complete user task. Frames and shadow roots require a separate supported observation.

Domos owns session, launch, profile, restore, certificate, and screenshot storage options. The tool catalog hides these options. Execution rejects hidden and unknown argument names. Native output schemas remain intact. Page text has a 32,000-character budget. Large text results ask the caller to use a narrower scope. Screenshots keep their native image content.

## Local and remote setup

The same execution rules apply to native work computers, spare computers, and VPS work computers. The selected work image must contain a browser. The default headless browser viewer also works without a graphical session. Desktop viewing needs an available graphical session. The application service image and the work image have separate jobs.

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

The installed adapter targets `agent-browser` 0.39.4. Configuration and command behavior were checked against the [official configuration reference](https://agent-browser.dev/configuration), [command reference](https://agent-browser.dev/commands), and [versioned MCP implementation](https://github.com/vercel-labs/agent-browser/blob/v0.39.4/cli/src/mcp.rs). Runtime profile and download paths come from the explicit server config. MCP calls pass only declared arguments. The [Windows output capture fix](https://github.com/vercel-labs/agent-browser/pull/2160) bounds output draining after child exit. See the [local comparison](reports/browser-takeover-2026-10-26.md) for its measured scope. Memoh informs the compact tool boundary. OpenMausBot informs bounded navigation observation. openbot informs draining and input readback. rakazo informs action batching and shared screen ownership.

Browser frames and pacing follow the [agent-browser streaming reference](https://agent-browser.dev/streaming). Browser input commands follow the installed 0.39.4 command implementation. Desktop capture and delivery follow the [Cua MCP tools reference](https://cua.ai/docs/cua-driver/reference/mcp-tools). Fullscreen follows the [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) and [Electron session permissions](https://www.electronjs.org/docs/latest/api/session). Text handling follows the [compositionend event](https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event), [input event](https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event), and [wheel units](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode).
