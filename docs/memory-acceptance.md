# Memory acceptance on Windows

The rule and browser checks ran on Node 24.22.3. The core memory change is `6a33214`. Native reports record the tested working tree and suite `memory-1`.

## Regression

- CI unit suite: 572 passed, 70 skipped across 87 files. Skipped cases are not acceptance evidence.
- Native context, recovery and protocol suite: 72 passed.
- The final memory, Work, native lifecycle and recovery check: 67 passed. The final date and tool-source assertions also passed in the six memory tests.
- Typecheck passed. Lint passed with 15 existing warnings outside this change.
- Bot details browser suite: 12 passed, 3 failed. The new memory test passed, including two approvals, original-message navigation, deletion, service kill/reopen, both themes and narrow layout.

All three browser failures also reproduce on the unchanged baseline `4524b1a`: delayed profile reads, detail-page request counts and profile-error retry. They concern the existing profile preparation flow. They are not reported as passing or fixed by the memory change.

## Real Agent runs

Codex CLI 0.171.0 used its reported `gpt-6.1-terra` model with low effort. Each case used a fresh temporary Domos database. The explicit budget was 120 seconds and 400000 reported tokens per case.

| Case | Deterministic rules | Total time including setup | Reported tokens |
| --- | --- | --- | --- |
| Beijing to Shanghai | 6/6 | 28.53 s | 201448 |
| Paraphrase retrieval | 3/3 | 39.80 s | 109053 |
| Manual preference | 3/3 | 14.64 s | 79729 |
| Deleted fact | 3/3 | 12.53 s | 80167 |
| Worker crash and reopen | 3/3 | 21.02 s | 79720 |
| Private Bot boundary | 3/3 | 13.66 s | 80279 |

The total is 21/21 deterministic rules. Manual inspection of these six answers found the expected current/historical city, operation order, language preference, unknown deleted city, metric units and unavailable private project. The city answer cited Shanghai entry 27 and Beijing entry 13. The paraphrase answer cited its original entry 13. These are six fixed examples, not a general accuracy benchmark. The persisted report retains `unreviewed` for automated semantic scoring; the manual inspection is recorded here separately.

The run reported 630396 processed tokens: 74330 uncached input, 1186 output and 554880 cache reads. Currency cost remained unknown. No judge model ran. No unintended memory writes appeared in the manual, deletion or isolation cases.

OpenCode with its reported `openai/gpt-6.1-terra` model passed the paraphrase case's 3/3 rules. This is one case, not six-case cross-Harness acceptance.

Pi listed `openai/gpt-6.1-terra`, but its configured provider returned HTTP 404 `model_not_found`: `Model "gpt-6.1-terra" is not supported by any configured provider in this group`. The final runner retained the failed task, native error, memory state and usage. This environment failure is not a model score or a passing Agent task. No provider or model substitution was made.

An earlier city run exceeded its 250000-token budget. It was not counted as a pass. The final explicit 400000-token run above stayed within budget. Offline rescoring of the final report completed without model calls.

Raw JSON reports and temporary databases remain in the local temporary directory. They contain synthetic questions and original evidence. Use [the eval command](memory-evals.md) to reproduce results with another user's installed account and chosen model.

## Limits

Memory deletion preserves original chat and does not erase already admitted native context. Source-ID and fingerprint tombstones do not provide universal semantic forgetting. Date checks require a date present in the original quote; they do not prove that a user's claim is true.

Native eval tools retain the OS account's permissions. Temporary work directories do not create a hard security sandbox or a hard anti-cheating boundary. Provider availability and request cost remain external dependencies. No semantic index or model judge was introduced.
