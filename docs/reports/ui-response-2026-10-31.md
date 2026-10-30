# Workspace response checks

Platform: Windows. Date: 2026-10-31.

## Changes

The model selector retains Harness status and capabilities in shared Bot state.
Connection checks share in-flight work and reuse matching results for three seconds.
Model and effort choices update immediately. Saves run in order. Dispatch waits for saves.
Chat reads stored entries in pages of at most 200 messages. Live updates send changed messages and runtime fields.
Tool output and images load through authenticated single-record reads. Work reads preceding pages when needed.
The full-history client path and Runtime history cache were removed. Existing CLI watches retain full records.

## Measured results

The stored conversation had 8204 messages before the change. Its response was 40,476,134 bytes.
The updated response was 106,942 bytes and contained 162 messages from the bounded entry page.
The response retained a cursor for older history. It contained no inline screenshot bytes.
In one desktop sample, parsing took 0.4 ms and serialization took 2.1 ms.
Returning to the retained Pi catalog took 43.7 ms.
With configuration saving held at the network boundary, model selection painted in 17.9 ms.
Seven effort options remained enabled. The sample recorded no main-thread long task.
The test rejected its configuration write and reloaded the page. It did not change the stored model.
These samples measure UI and transport behavior. They do not measure Agent task speed.

## Verification

The unit suite passed 362 tests and skipped 40 tests.
The focused API suite passed 14 tests after the final compatibility adjustment.
Typecheck passed with the installed compiler's single-thread mode. Lint retained eight existing warnings.
Focused browser checks passed for immediate selection, save failure, queued effort saves, dispatch ordering, paged history, outgoing paint and Work records.
An additional full workspace run stalled during startup as Windows virtual memory ran low. It was stopped.
The desktop build passed. The running Electron UI was inspected.
Other operating systems and real model task performance were not tested.
