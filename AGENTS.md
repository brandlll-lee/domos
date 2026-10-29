# Domos

Domos provides persistent AI companions with memory, tools, and work computers.
Users choose their models and deployment: local, self-hosted, or cloud.
Pi Durable 1.4.0 stores Bot tasks. Native Harness processes own model loops. Domos owns product capabilities.

## Architecture and ownership

- The client device, Domos service computer, and Bot work computer are separate roles. They can be on different computers.
- Commands, files, and desktop actions use the Bot's bound work computer. Do not assume that it is the client or service computer.
- Domos owns Bot identity, full chat history, memories, and computer permissions. Native Harness accounts use the work computer's OS user and configuration. Preserve retained service credentials during migration.
- Memory records belong to one Bot unless the user shares them. Keep profile snapshots stable for each Durable task. Route every Harness through the shared memory tools. Background review uses a separate native session and cannot change user-authored records.
- Durable owns input admission and persistent tasks. Native Harness processes own generation and model context. Adapters coordinate cancellation and recovery through public protocols. Observe uncertain results before more mutations.
- Reuse the work computer's CLI before installing a version in its Domos runtime directory. Inspect, login, and execute with the same program and OS user. Switch programs and Harness only while the Bot is idle.
- Native CLI transports own model HTTP. Use Photon and model image limits at the attachment boundary. Preserve original evidence and include coordinate mapping when resizing observations.
- Keep system instructions stable across tool rounds. Read current time through routine_list. Bound tool images in model requests while retaining full evidence and user attachments. See [Harness context](docs/harness-context.md).
- Send chat, additional input, routines, API calls, and CLI calls through Runtime.submit and the same Durable conversation. Keep request IDs stable through retries.
- Keep model context separate from displayed history. Read [docs/harness-context.md](docs/harness-context.md) before changing history, migration, or compaction.
- Keep computer rules in shared services. Persist tool results. Do not replay mutations whose outcomes are uncertain.
- Verify product-tool discovery before native task dispatch. Read [Harness context](docs/harness-context.md) before changing tool bridges or readiness checks.

| Location | Responsibility |
| --- | --- |
| `apps/api` | HTTP and RPC boundaries, request handling, and service composition. |
| `apps/web` | Browser UI, client state, and user interactions. |
| `apps/desktop` | Electron lifecycle, preload boundary, desktop setup, and packaging. |
| `apps/controller` | Authenticated control service for remote work sandboxes. |
| `apps/cli` | Command-line entry points, hosting, and eval commands. |
| `packages/agent` | Bots, durable tasks, chats, memory, files, and work environments. |
| `packages/agent/src/runtime` | Durable admission, native task coordination, storage migration, and full chat projection. |
| `packages/agent/src/harness` | Native drivers, CLI discovery and login, work-process services, bounded history reads, and usage records. |
| `packages/agent/src/computer` | Computer bindings, shared tools, control ownership, viewers, and optional Jev assistance. |
| `packages/hosting` | Hosting setup, credentials, device sessions, installation, and service lifecycle. |
| `packages/ui` | Shared controls, theme tokens, avatars, and computer-effect rendering. |

## Computer Use contracts

- Reuse Cua for desktop execution and the existing browser service for DOM/CDP operations. Keep platform details at these boundaries.
- Browser viewing uses the Agent browser viewport stream and browser input commands. Cua owns desktop viewing and input. Share display control only for a confirmed headed browser. Keep the identity header fixed across Bot, Computer, and Browser tabs. Use the native Fullscreen API for the screen and toolbar. See [Browser Use](docs/browser-use.md).
- Desktop mutations normally use `run_steps` with end observation. Keep known continuous actions in one batch. Check a state transition before actions that depend on it.
- Bind actions and observation to the same confirmed window and session. Discover and bind a new target when a dialog or window changes.
- Distinguish action delivery, action verification, observation, and user-task completion. A successful call or screenshot alone does not prove task completion.
- If an action ran but observation failed, preserve the execution record and recover observation. Do not replay an action whose outcome is uncertain.
- Preserve the saved native tool catalog, including output schemas and annotations. Deliver structured metadata in supported text content and retain screenshots with their current coordinates. Put Domos status outside strict native structured output.
- Apply observation recovery and cancellation to direct actions, batches and scripts. Scripts require fresh observation before further mutations. Track script effects from native cursor state.
- Preserve approval, cancellation, and user takeover on every execution path, including Jev assistance.
- Route ordinary computer mutations through the shared approval callback. Browser observation tools use an explicit allowlist; arbitrary JavaScript requires approval.
- Keep dispatched browser work alive until it settles. Cancel queued work. Preserve the page during takeover. Persist uncertain execution across worker restarts, and require explicit browser restart before more mutations.
- Share control between a headed browser and its desktop. Isolate control only after the worker confirms a headless browser. Wait for human input to finish before returning control.
- Route Agent handoff requests through the shared `computer_request_takeover` tool and stored chat cards. Complete only the live request whose viewer owns control. Closing a viewer does not complete a request.
- Reserve a viewer's lease before takeover waits. Keep its frames and acknowledgements live during the grant. Allow input only after the grant completes. Reuse concurrent requests from that viewer and release its reservation when it closes.
- Browser navigation and known page actions return bounded observations. Batch known continuous browser actions with `agent_browser_run_steps`. Use `agent_browser_observe` after takeover or unclear screenshots. Preserve delivered actions when observation fails. Do not infer missing-content causes from blank space or document readiness.
- Browser mode belongs to the shared work-browser service. Change it only through a confirmed restart. Reuse the Bot profile. Hold browser and desktop control during the change. Report observed access evidence; do not hardcode website fallbacks or open personal browsers.
- For viewer input, layout, or reconnect changes, follow [docs/browser-use.md](docs/browser-use.md). Test clicks through the scaled image and read back the real page. Scripted focus and mocked RPC output do not verify takeover.
- Preserve native action results when observation or evidence storage fails. Keep runtime browser arguments in Domos, and apply text limits at the browser boundary. See [docs/browser-use.md](docs/browser-use.md).
- Keep cursor and border tracking separate from execution. Use the shared effect renderer and Bot theme color. Effect failures must not block actions or change their result.
- Track coordinate units explicitly. For effects, convert physical pixels, logical points, and screenshot coordinates once at the drawing boundary.

## Change discipline

- Read the affected code and its callers before editing. Make the smallest complete change that satisfies the request.
- Reuse existing services, controls, dependencies, and platform APIs. Add an abstraction or dependency only when the current task needs it.
- Keep each module responsible for one coherent area. Put a fix in the shared owner rather than adding parallel paths for each caller.
- Remove unused code, obsolete branches, and tests that no longer apply. Keep validation, cancellation, and error handling needed by active callers.
- Keep tests proportional to behavior. Extend the existing relevant test where possible. Replace stale cases rather than stacking duplicate cases.
- Use comments for non-obvious domain or OS constraints. Keep change history in Git.
- Reuse `packages/ui` controls and tokens. Build visual hierarchy with spacing and typography. Add labels and descriptions only when they provide needed information.
- Keep workspace navigation in the contact column. The centered Bot capsule opens details. Put model and context controls in the Bot tab. Reserve native window controls and keep interactive controls outside drag regions. See [Workspace UI](docs/decisions/0005-workspace-ui.md).
- Use React View Transitions for panel opening and closing. During pointer resize, apply the latest width once per frame and let transcript text reflow. Animate compact sidebar changes with shared CSS width transitions and motion tokens. Keep snapshot transitions out of dragging and snapping. Start an interrupted drag from the displayed width. Keep transcript position and drafts stable. Honor reduced motion. Closing a viewer still releases its control lease.
- Use short sentences and active voice. Report confirmed results separately from assumptions and unverified behavior.
- Check installed versions and current official documentation before changing external API or protocol behavior. Reference projects inform design; their rules do not govern this repository.

## Verification

- Use the scripts in `package.json` as the command source. Run focused tests for the changed behavior first, then the checks required by affected consumers and CI.
- Run `pnpm typecheck` and `pnpm lint` for code changes. Fix new errors and report retained warnings.
- For Harness or Computer Use changes, read [docs/computer-evals.md](docs/computer-evals.md) before changing behavior. Save the relevant failure or baseline first. Run the regression after the change.
- Add new confirmed failure cases to the small, sanitized eval set. Report completion evidence, coverage, elapsed time, and model round trips when available. Without eval evidence, do not claim a Harness performance or success-rate improvement.
- Offline trajectory scoring evaluates recorded behavior. Scorer tests test the scorer. Neither reruns an Agent. Rule pass rates are separate from task success rates.
- Verify visible UI changes in the running UI. Use real input and result readback for native input claims; simulated protocol tests are not native desktop acceptance.
- Wait for a state or event in tests. Use timeouts as hang guards. Keep a performance threshold tied to the work it measures and report runner limits.
- For cross-platform claims, inspect Windows, Linux, and macOS results for the same commit in `.github/workflows/checks.yml` and `.github/workflows/computer-effects.yml`.
- Report skipped and untested capabilities explicitly. Green CI does not prove every OS permission, desktop session, or third-party application works.
- Documentation-only edits need link, path, and diff checks. Do not add tests that assert document wording.
- Push and PR workflows skip changes limited to root `AGENTS.md`, root `README*.md`, and Markdown under `docs/`. Other changes run the full workflows. Before making these workflows required checks, review path filtering so a skipped workflow cannot leave a required check pending.

## Environment secrets

- Do not read, search, display, or log secret values from environment files or process environments.
- Application code may load and use secrets at runtime.
- Check secret files only for existence and Git ignore status.
- Preserve existing secret files. Do not overwrite them.
- Keep `.env.example` free of secret values.

## Data and local processes

- Preserve user data and existing public contracts. Keep authentication, authorization, IPC validation, Electron sandboxing, and context isolation at their boundaries.
- Restart only identified Domos processes. Check PID, executable path, and ownership before stopping them. Do not kill all Electron processes or an entire tree that may contain user applications.
- Use a small test window for desktop checks when possible. Use the user's requested application only within the authorized task.

## Git workflow

- Create feature branches from the latest `main`. Develop and commit in the existing repository directory, one feature at a time.
- Commit or stash local changes before switching branches. Create a Git worktree only when the user explicitly requests one.
- Keep `main` clean between integrations. Review and test each feature before merging it into `main`.
- Push when authorized by the user. Verify the merged commit and all required CI results.

## Keep this guide current

- Update this file in the same change when module ownership, public contracts, development workflows, or verification boundaries change. Replace or remove stale guidance.
- Store current decisions and rules here. Keep task progress, incident timelines, commit IDs, CI run links, and temporary plans in task reports or Git.
- Link to existing specialist documentation when a task needs detail. Do not duplicate command catalogs or file inventories that the code already provides.
- Keep `AGENTS.md` as the shared project source. Check each AI client's repository-instruction entry point before claiming it loads this file. Any required compatibility entry should point here instead of copying the rules.
