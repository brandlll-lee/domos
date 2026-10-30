# Native computer execution

## Current contracts

- The desktop relay sends one native call with the original arguments.
- Cua owns sessions, action delivery and observation. The Agent requests each operation.
- Shared permissions, takeover, cancellation and intent/result records remain active.
- Display projection writes changed messages. Tool events request a background flush.
- Native session acceptance waits for storage. Terminal handling drains display writes.
- Pi records receipt times before queued processing.
- Effects use returned geometry and completed actions. They do not query Cua or wait for capture acknowledgements.
- Cached effect geometry expires. The driver owns live script cursor motion.

## Baseline

The sanitized `cua-contracts.json` nativeFlow record preserves task 10519.
It ended after Stop. The target track was not verified.

| Measure | Recorded value |
| --- | ---: |
| Elapsed time | 155.762 s |
| Model responses | 17 |
| Tool calls | 17 |
| Twelve returned desktop calls, wall time | 39.489 s |
| The same calls, internal time | 12.566 s |
| Failed observation wait | 31.497 s |

The time difference includes transport and storage. It does not isolate one cause.
The failed observation has no native result. Its internal blocking phase remains unknown.

## Regression

Windows native input tests read back Chinese text, button output, batches and consecutive scripts.
An explicit session end requires an explicit native start. Batch observation uses explicit arguments.
Overlay tests check IPC, capture exclusion, window reuse and shutdown.
Slow-storage tests check event delivery, sparse writes, receipt times, terminal flush and stopped-turn isolation.
Existing Harness tests cover protocol adaptation, approvals, cancellation, takeover and journal replay protection.
The final unit run passed 361 tests and skipped 40 tests. Four Windows desktop tests passed.
Type checking passed. Lint retained eight existing warnings and reported no errors.

The live regression used Pi and deepseek-flash in an isolated Domos conversation.
The request asked the player to play a specified song by a specified artist.
It used the same OS account and native desktop service.
The player was already running and minimized. The conversation had no earlier task history.

| Measure | Recorded value |
| --- | ---: |
| Elapsed time | 32.480 s |
| Model responses | 11 |
| Tool calls | 10 |
| Tool wall time | 6.853 s |
| Fixed sleeps | 0 |

The Agent recovered from one native background-hotkey refusal.
A separate native read confirmed the requested title and artist. It also found the player pause control.
This verifies the player UI. It does not verify speaker output.

The sanitized `pi-native-baseline.json` retains this complete call sequence.
Offline scoring passes 2/3 rules. It retains the unverified PostMessage return-key warning.
Later UI verification does not erase that delivery warning.

The contexts and initial states differ. These times do not establish a speed gain.
The 31.497-second observation timeout did not occur in this run. Its cause is not established.
Live model execution covered Pi. Other Harnesses have protocol coverage for this change.
Linux and macOS native desktop behavior was not tested locally.
