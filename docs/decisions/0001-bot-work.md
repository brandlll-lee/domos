# Bot work

Status: accepted.

Durable documents own Bot memory, managed skill metadata, routine definitions, and run receipts. Writes use revisions and request IDs. Memory and skill text do not grant permissions.

## Skills

Native Harness protocols supply their loaded skill catalogs. The catalog shows the reported source and path. Native entries are read-only in Domos. Enabled managed skills with the same name are omitted from model instructions. An unavailable catalog stays unknown. Generic ACP does not define a skill catalog.

Managed skills follow the Agent Skills directory format. A ZIP contains SKILL.md and supporting references, scripts, and assets. Import and update show file differences before saving. Packages have a SHA-256 content hash and immutable ZIP storage under the existing Files root. Documents retain version metadata. Restoring a version creates a new version. Existing single-file skills retain their content and gain a package on their next save.

Enabled skill metadata enters context. Bodies load through skill_read. Supporting files materialize in the Bot's bound work directory. Routine firing snapshots the bound skill body and revision. The Agent uses skill_read for supporting files. Deleted or disabled bindings produce a failed receipt.

## Routines

Croner calculates calendar instants. A conversation-owned Durable task waits and submits routine input through Runtime.submit with a stable request ID. A restart resumes the stored checkpoint. Missed recurring instants produce one catch-up run. The next instant follows completion.

Chat tools create, edit, pause, resume, run, and delete routines. The shared approval card shows the proposed change. Approval applies the change. Rejection leaves it unchanged. Editing an enabled routine preserves its enabled state. Direct editor saves pause the routine until the user enables it.

Runs report queued, running, waiting for an answer, waiting for approval, stopped, failed, or done. A run links to its native Work record. Active execution time and human wait time are separate. The execution limit defaults to 15 minutes and accepts one second to 24 hours. Human waits pause this limit. Expiry stops the native Harness process through the shared Stop path and records failure.

Pausing or deleting a schedule does not cancel admitted work. Chat Stop can stop the active routine. The local host must stay running for scheduled work. Routine work uses the existing Bot permissions.

## Native contracts

- [Agent Skills specification](https://agentskills.io/specification)
- [Pi skills](https://pi.dev/docs/latest/skills) and [RPC commands](https://pi.dev/docs/latest/rpc-commands)
- [Codex app server](https://developers.openai.com/codex/app-server): skills/list
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript): skill metadata and reloadSkills
- [OpenCode skills](https://opencode.ai/docs/skills/) and [server contract](https://github.com/anomalyco/opencode/blob/v1.2.27/packages/opencode/src/server/server.ts): GET /skill
