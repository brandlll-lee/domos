# Antigravity MCP and usage acceptance

## Recorded failure

Antigravity 1.5.9, Claude Opus 4.6 Thinking, Windows. Tasks 17520 and 17545 completed their native prompts. Domos then failed settlement with `antigravity 用量计数无效：input。`. Their raw terminal usage frames were not retained.

Native session steps 4, 12 and 20 rejected `image_generate` with `tool image_generate is not enabled for server domos`. A separate product call succeeded. No Domos image-generation receipt exists for those rejected calls.

The native regression uses a temporary workspace, 30 large catalog entries and one larger `image_generate` fixture. The fixture returns a random receipt and makes no image-service request. Before the change, the same installed model and CLI reported the recorded rejection. The callback received zero calls.

## Acceptance

With deferred registration, the same native test called the original `image_generate` fixture once with the exact requested arguments. The reply contained its receipt. A separate native test called a managed MCP tool through the same bridge. These samples establish tool availability, not a throughput or success-rate claim. Model round trips were not measured.

The lifecycle regression separately supplies uncached input 100, cached reads 900 and output 20. It checks retained raw counters. A malformed native cost checks that the reply and completed run survive reopening while settlement emits a warning.

## Upstream evidence

- [Antigravity eager-tool eviction, including 1.5.9](https://github.com/google-antigravity/antigravity-cli/issues/1530).
- [Antigravity MCP tool loading](https://antigravity.google/docs/mcp/).

The native invocation test does not verify paid image generation or other operating systems.
