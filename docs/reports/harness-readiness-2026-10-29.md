# Harness readiness acceptance

Scope: program discovery, product-tool readiness, selector snapshots, and setting-row alignment.

The saved Windows npm path failed discovery. Selecting the provider again used a command name and succeeded. Pi's user MCP extension replaced the built-in implementation and did not consume Domos server registrations. The first setting row had an extra wrapper, so shared row styles did not apply.

The resolver now checks paths on the work computer. Pi uses direct extension tool registration. Native task dispatch waits for gateway discovery and supported native status checks. The selector retains verified snapshots during refresh. Its rows use the existing shared controls. Duplicate form rendering and unused provider styles were removed.

Validation uses temporary data. The four native tests use real accounts and model calls. They require a product tool call, a successful desktop window-list read, and a fresh response marker. Pi ran with the user's MCP extension present. Custom ACP uses protocol tests, including rejection of a missing HTTP MCP capability. It has no live third-party acceptance in this report.

The UI regression blocks inspection responses while reopening the selector. It checks model availability, provider return, label alignment, and rail overflow. Existing desktop tests verify real input and result readback separately. These tests do not prove full user-task completion or a model success-rate improvement.

Windows is the local verification platform. Checks includes Windows, Linux, and macOS. SSH and Docker retain their existing CI jobs. Local results do not prove remote jobs passed. Fetching GitHub failed during this run. Unpushed commits have no remote CI evidence.

Local results:

- Unit tests: 338 passed, 39 skipped; 74.31 seconds.
- Native Pi 1.4.0, Codex 0.163.0, Claude Code 2.1.284, and OpenCode 1.19.0: 4 passed; 107.04 seconds. OpenCode used `deepseek/deepseek-flash`. Other CLIs used their native default model. Each tool call read the real work-computer window list and returned a fresh marker. Model round trips were not collected.
- Desktop E2E: 7 passed; 36.2 seconds. This includes foreground input and result readback.
- Web E2E: 82 passed; 7.4 minutes. The identity test selects a different shape explicitly because random avatar selection can repeat its current seed. An earlier focus failure passed in isolation and in the final full run.
- Typecheck passed. Lint passed with 8 retained warnings.

The native tests perform read-only observation. They do not repeat the user's music task or establish cross-platform task success rates. No native acceptance ran on Linux, macOS, SSH, or Docker in this session.
