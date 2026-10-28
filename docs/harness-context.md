# Harness context

## Ownership and admission

Pi Durable 1.4.0 owns the model context and execution loop. Domos stores the complete transcript. Chat, additional input, and routines use Conversation.submit. Stable request IDs deduplicate retries. The native inbox controls steering and follow-up input.

GenerationTask and ToolTask own cancellation and recovery. Computer mutations are sequential tools. They do not declare replay safety. Pending approvals expire on restart. An uncertain action needs a fresh observation before another mutation.

## History and migration

Before the upstream SQLite schema migration, openStorage creates a consistent .v1-backup. The migration retains messages, attachments, and memories. It settles old tasks and preserves partial replies as stopped messages. It imports bounded recent history as quoted context once per Bot. Existing Durable conversations retain their context.

The handoff scans up to 64 entries. Each text excerpt has a 4000-byte limit. The serialized packet has a 16000-byte limit. JSON escaping and metadata count toward that limit. UTF-8 characters stay intact. Historical images and private reasoning do not enter the handoff.

The conversation_read tool reads stored history:

- {} reads a recent page. Use its from cursor as before for older entries.
- { "entryId": 123, "offset": 0 } reads a complete record in chunks. Follow nextOffset until null. Offsets count UTF-8 bytes and must align with a character boundary.

Each record read is bound to the current Bot. Text chunks have a 4000-byte limit. Mixed cursor modes and invalid offsets fail. File references retain their work computer identity.

## Compaction and display

Durable owns automatic and manual compaction. Domos reports an estimate from the active native context and the configured model's context window. The estimate is not an exact provider tokenizer.

Model HTTP uses Pi CLI 1.4.0's proxy-aware Undici configuration and matching fetch implementation. Durable retains retry and cancellation ownership.

The native Photon worker prepares user and tool images before model requests. Model image limits override the Pi defaults. Resized images include coordinate mapping. Stored images, attachments, and tool details remain intact. Each request starts from the original image, so a model change keeps the coordinate mapping correct. Decode failures preserve the delivered result, as Pi CLI does. Images already within the model limits retain their size; this does not impose a total conversation image budget.

The UI reads raw stored entries. Compaction summaries and migration handoffs stay out of displayed messages. Compaction changes model context only. Full records remain available through conversation_read.

The SQLite pagination patch reads 32 document revisions per query. It preserves order, historical bounds, version checks, and the read transaction. Recheck the patch on dependency upgrades.

## Verification

harness-context.test.ts checks byte budgets, UTF-8 chunks, complete record reads, and Bot isolation. harness-recovery.test.ts checks migration, memory retention, expired approvals, submission deduplication, and full display history after compaction and restart. Lifecycle and takeover tests check the native loop and shared computer control. These tests do not prove paid-provider recall or native desktop input on every OS.

## Sources

- [Pi Durable 1.4.0](https://github.com/earendil-works/pi/tree/v1.4.0/packages/durable)
- [Pi AI 1.4.0](https://github.com/earendil-works/pi/tree/v1.4.0/packages/ai)
- [Pi CLI HTTP initialization](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/http-dispatcher.ts)
