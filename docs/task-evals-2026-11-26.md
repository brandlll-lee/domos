# Eval grading acceptance — 2026-11-26

Spec02 adds automatic semantic grading, native Harness/model selection and explicit experiment factors. It fixes the R2 prompt so the test can exercise a real refusal. It does not change Agent product behavior.

## Configuration

- Subject and judge: installed Pi 1.5.2, `deepseek/deepseek-flash`, `thinkingLevel=low`.
- The installed Pi model catalog reports `https://api.deepseek.com`. No OpenRouter model was selected.
- DeepSeek's [pricing documentation](https://api-docs.deepseek.com/quick_start/pricing.md) maps that alias to [DeepSeek-V4.1-Flash-1017](https://api-docs.deepseek.com/news/news261017/). The service alias is not an immutable version pin.
- Subject approval mode: full. Judge approval mode: ask. Judge interactions and tool calls invalidate the judgment.
- Judge digest: `ff230b298ff0aa40b222c3453334ac8cc01cb6ade1dc6893cd58ddc37291087f`.

## Real results

| Run | Result | Native tokens | Reported USD |
| --- | --- | --- | --- |
| Development references | 36/36 match | Included below | Included below |
| Frozen holdout references | 36/36 match | Included below | Included below |
| Both calibration sets | 72 calls; no false passes | 857,441 | 0.260705412 |
| Old baseline semantic regrade | 13 judgments | 156,344 | 0.047074836 |
| New H1 pilot judge | Pass | 12,264 | 0.003732072 |
| New subjects | F1, H1, B1, R1 once; R2 three times; 7/7 pass | 924,018 | 0.055184628 |
| All new paid activity | 86 judge calls and 7 subject trials | 1,950,067 | 0.366696948 |

Each calibration set has 18 correct and 18 incorrect trials. Each of its 12 samples has three consistent results. Every semantic category matches on 6/6 trials per set. The confusion matrix is 18 true positives, 18 true negatives, zero false positives and zero false negatives per set.

Labels come from the Spec's task standards. Independent human review of those labels remains pending. These small synthetic sets establish reference agreement. They do not establish perfect real-world judge accuracy. The same model judges subject answers; self-preference remains a limit.

An initial environment probe failed before a model request because the fresh evaluation computer lacked authorization. Its report remains separate. The corrected probe used a new directory. No successful record replaced that failure.

The new pilots used the implementation working tree above main `52349f8ca91c7bb3c77ae4a7cca848dbeab895a5`. Their reports correctly record `dirty=true`. They validate execution and grading. They do not establish a code-version improvement or a cross-Harness ranking. Cross-configuration comparison rules have deterministic tests; this acceptance uses only the requested Pi/DeepSeek combination.

## Historical evidence

The original 48 trials now score 39 pass, 9 fail, zero unreviewed. All 13 prior semantic gaps received judgments. The original report digest still matches its retained source reference. Original trial evidence, inventories and task inputs remain intact.

The nine retained failures are two H1 provenance failures; one B1 timeout; one B2 delivery/timeout failure; three B4 read-only violations; and two old R2 approval-coverage failures. The new R2 prompt does not relabel those old trials. A complete report containing these known failures correctly exits 1. It has no grading gaps.

Old subject costs remain unknown. The new judge cost is separate. The USD amounts above use native reported accounting and are not invoice reconciliation.

## Evidence and cleanup

Evidence stays under `C:/Users/ASUS/domos-evals/`:

- `spec02-development-v2-20261126/report.json` and `summary.json`.
- `spec02-holdout-20261126/report.json` and `summary.json`.
- `spec02-baseline-regraded-20261126.json`, its Markdown report, and `spec02-baseline-grading-20261126/`.
- `spec02-pilot-20261126/run/report.json`.
- `spec02-memory-pilot-20261126/run/report.json`.
- `spec02-r2-20261126/run/report.json`.
- `spec02-summary-20261126.json` for aggregate accounting.

All 93 successful judge/subject environments closed and completed cleanup. They released 12,157,877 bytes of temporary workspace/runtime data. Their post-cleanup measurements retained 43,687,609 bytes of databases and evidence. Later audit JSON adds a small amount. Retained evidence continues to consume disk; it is not disposable cache. The runner checks space before dispatch and keeps cleanup inside each trial's owned paths.

## Verification

TDD records include failures for missing semantic grading, incomplete-batch exit priority, model selection, invalid source citations and inconsistent calibration evidence. Corresponding public-interface tests passed after implementation.

Local lint and type checking passed. The focused eval suite passed 42 tests across six files. CI selection passed seven tests. The selected CI scope is `evals=true`, `full=false`; native, desktop, browser-input and sandbox matrices remain outside this eval-only change. Paid EDD runs stay explicit and local.

See [task eval commands and contracts](task-evals.md) for calibration, normal runs, regrading and paired experiment input.
