# Bot work

Status: accepted.

Pi documents own Bot memory, the shared private skill library, routine definitions, and run receipts. Identity names stay in the Bot directory. Standing instructions stay in Pi agent configuration. Writes use revisions and request IDs.

Pi sections render identity, bounded memory, and enabled skill metadata before requests. Skill bodies load on demand. The inspector replays committed system messages through Pi AI. It does not render a second preview. Memory and skill text do not grant permissions.

Croner calculates future calendar instants. A conversation-owned Pi background task waits and submits each routine input with a stable request ID. Pi queues input while the Bot works. A restart resumes the stored checkpoint. Missed recurring instants produce one catch-up run. The next instant follows completion. A bound skill is read at firing and its exact content is saved with the run. A removed or disabled binding produces a failed receipt.

New routines are paused. The user enables them in Bot details. Editing pauses future execution. Pausing or deleting does not cancel work that has already started. Ordinary chat stop can stop a routine's admitted input. Run receipts retain the resulting status.

The local host must run for scheduled work. This change adds no cloud host. Test runs execute real tools. Routine work uses the existing Bot tool permissions.

No existing conversation schema changes. New document kinds retain their data when code is reverted. Pause enabled routines before reverting this change. Back up the existing Pi database with the normal application shutdown procedure.
