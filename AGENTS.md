# Domos

Domos provides persistent AI companions with memory, tools, and work computers.
Users choose their models, Harness, and deployment: local, self-hosted, or cloud.
Keep these choices independent. Support Pi, Codex, Claude Code, and OpenCode through shared product capabilities.

## Architecture and ownership

- The client device, Domos service computer, and Bot work computer are separate roles. They can be on different computers.
- Commands, files, native engine accounts, and desktop actions use the Bot's bound work computer. Do not assume that it is the client or service computer.
- Domos owns Bot identity, chat history, memories, and task records. Each Harness owns its native execution session.
- Native sessions are scoped by work computer, engine, and account context. Preserve chat history across engine changes. Reuse compatible sessions. Keep context handoffs within size budgets.
- Advance a session's history cursor after confirmed prompt acceptance. Keep pre-dispatch checkpoints separate from acceptance. For Harness history, recovery, or budgeting changes, read [docs/harness-context.md](docs/harness-context.md).
- Keep product rules in shared services. Harness adapters translate native protocols; they do not each implement their own computer workflow.

| Location | Responsibility |
| --- | --- |
| `apps/api` | HTTP and RPC boundaries, request handling, and service composition. |
| `apps/web` | Browser UI, client state, and user interactions. |
| `apps/desktop` | Electron lifecycle, preload boundary, desktop setup, and packaging. |
| `apps/controller` | Authenticated control service for remote work sandboxes. |
| `apps/cli` | Command-line entry points, hosting, and eval commands. |
| `packages/agent` | Bots, durable tasks, chats, memory, files, and work environments. |
| `packages/agent/src/harness` | Engine execution, session recovery, native protocol adapters, and work-process services. |
| `packages/agent/src/computer` | Computer bindings, shared tools, control ownership, viewers, and optional Jev assistance. |
| `packages/hosting` | Hosting setup, credentials, device sessions, installation, and service lifecycle. |
| `packages/ui` | Shared controls, theme tokens, avatars, and computer-effect rendering. |

## Computer Use contracts

- Reuse Cua for desktop execution and the existing browser service for DOM/CDP operations. Keep platform details at these boundaries.
- Desktop mutations normally use `run_steps` with end observation. Keep known continuous actions in one batch. Check a state transition before actions that depend on it.
- Bind actions and observation to the same confirmed window and session. Discover and bind a new target when a dialog or window changes.
- Distinguish action delivery, action verification, observation, and user-task completion. A successful call or screenshot alone does not prove task completion.
- If an action ran but observation failed, preserve the execution record and recover observation. Do not replay an action whose outcome is uncertain.
- Preserve native tool output schemas. Put Domos status in supported result content, not extra fields in strict structured output.
- Preserve approval, cancellation, and user takeover on every execution path, including Jev assistance.
- Route ordinary computer mutations through the shared approval callback. Browser observation tools use an explicit allowlist; arbitrary JavaScript requires approval.
- Keep dispatched browser work alive until it settles. Cancel queued work. Preserve the page during takeover. Persist uncertain execution across worker restarts, and require explicit browser restart before more mutations.
- Share control between a headed browser and its desktop. Isolate control only after the worker confirms a headless browser. Wait for human input to finish before returning control.
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
