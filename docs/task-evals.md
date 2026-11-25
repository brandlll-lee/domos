# Task evals

The task suite measures real Domos outcomes. It uses the selected native Harness and model. Scripts check objective results. A calibrated model judge checks semantic results. A successful tool call alone does not establish success.

## Cases

Run `pnpm exec node apps/cli/src/eval-tasks.ts --list` for the authoritative prompts, synthetic input files and expected results.

| Group | Cases | Evidence |
| --- | --- | --- |
| Files | F1 totals, F2 merge, F3 edit, F4 clarify | Published Files downloads and stored question |
| History | H1 city, H2 paraphrase, H3 deletion, H4 isolation | Per-question replies, source entries and memories |
| Browser | B1 budget, B2 export, B3 submit once, B4 injection | Real browser calls and fixture server state |
| Routines | R1 scheduled report, R2 refusal, R3 quiet checks, R4 change | Approval cards, runs, baseline, delivery and Files |

Browser fixtures run on loopback with synthetic data. They do not measure public website compatibility. R1 uses a real timer at 90 seconds after setup. R3/R4 use the existing run-now service and do not measure scheduling precision.

## Run

Use Node 24 or newer. Log in with the selected work computer's native CLI first. Each trial checks the native model and option catalogs. An unavailable configuration stops the batch. Each trial has separate Bot data, working directories, native sessions and browser profiles. The user account stays in the existing Harness configuration.

Use `--catalog --harness pi` to read available models and controls. Select an exact `--model` ID. Use `--options` with native option IDs and string values. The default remains Codex/Terra. Pi does not inherit Codex options.

The current EDD configuration is Pi + `deepseek/deepseek-flash`, with `thinkingLevel=low`, through `https://api.deepseek.com`. The official API alias currently serves DeepSeek-V4.1-Flash-1017. Native model readings remain separate from requested IDs.

Calibrate the fixed judge before semantic runs:

```sh
pnpm exec node apps/cli/src/eval-calibration.ts --set development --root /outside/repo/development
pnpm exec node apps/cli/src/eval-calibration.ts --set holdout --root /outside/repo/holdout
```

Each set has 12 reference samples, repeated three times. Expected labels come from the task standards. Reports explicitly retain independent human label review as pending. Reference agreement does not establish population accuracy. The holdout gate requires 36 matching results, known usage, no judge faults, current grader/sample digests and intact judgments. Changing the grader or samples invalidates that certificate. Replace a holdout if its errors inform a rule change.

Judge calls use fresh native sessions, ask permissions, no browser setup, a 120-second timeout and a 24-KiB required input bound. Their batch token budget is 2 million. Interactions and tool calls invalidate a judgment. This uses the existing OS account; it does not create an OS sandbox.

Start with one case from each group:

```sh
pnpm exec node apps/cli/src/eval-tasks.ts --harness pi --model deepseek/deepseek-flash --options '{"thinkingLevel":"low"}' --cases 'F1,H1,B1,R1' --repeats 1 --max-tokens 1000000 --max-batch-tokens 6000000 --calibration /outside/repo/holdout/report.json
```

Run the baseline with three repeats:

```sh
pnpm exec node apps/cli/src/eval-tasks.ts --harness pi --model deepseek/deepseek-flash --options '{"thinkingLevel":"low"}' --max-tokens 1000000 --max-batch-tokens 20000000 --calibration /outside/repo/holdout/report.json
```

One version plans 48 trials. Two versions plan 96. Multi-turn and routine cases can make multiple model requests. Pilot samples stay separate from the formal baseline. The initial browser pilot reported 518,598 tokens. It exceeded the default per-trial limit. Choose and record sufficient limits before a formal batch; retain budget failures.

Default limits: 300 seconds and 500,000 reported tokens per trial; 2,000,000 reported tokens per batch; 1 GiB retained evidence; 2 GiB minimum free disk space. Set `--seconds`, `--max-tokens`, `--max-batch-tokens`, `--max-mib` and `--min-free-mib` before the experiment. Token checks follow native tasks. Disk checks precede each trial. A limit stops later dispatch and cannot cap an issued request.

An optional positive integer `--max-cost` sets a USD dispatch budget. Missing native cost then stops dispatch. Without it, tokens control dispatch and cost can remain unknown. Missing native tokens stop dispatch. Missing amounts are never reported as zero.

Output defaults to `~/domos-evals/<timestamp-id>/`. `--root` selects another directory outside the repository. Existing run directories cannot be overwritten. Each batch writes `report.json` and `report.json.md`. Each trial retains `evidence.json`, the original database and Files originals. Trace retains call IDs, entry IDs, per-question replies, execution snapshots, actual task instructions, computer tool catalogs and observed usage. Named output files are read before workspace cleanup. Hidden native reasoning and HTTP requests are outside its coverage.

## Cleanup

Success, failure and timeout enter shutdown. The worker disables its routines, stops its active native task, closes its fixture and closes the runtime. The parent waits for worker exit before cleanup.

The runner retains database and published originals in stable evidence paths. It deletes only the trial's workspaces and runtime directory. These contain browser profiles, download copies and temporary files. Cleanup verifies owned paths, rejects links and records bytes before/after, released bytes and free disk space. Failed shutdown, evidence reads or cleanup stop the batch and preserve the remaining directory for inspection.

Retained files have SHA-256 digests. Evidence still consumes space. The runner stops at its space budget. Archive or remove a completed batch explicitly after review. User data, shared dependencies and account settings are outside cleanup scope.

## Review and regrade

F4, H1–H4 and B4 require semantic grading. Every condition returns a verdict, a reason and retained evidence keys. Scripts check historical source identity and original text. The judge checks meaning, order, negation, omissions, contradictions and source relationships. Hard failures skip paid grading. Model and manual reviews cannot override objective failures.

Normal runs grade semantic cases automatically and require `--calibration`. Pure `--trace` regrading stays offline. Add `--judge --calibration` for paid semantic regrading. Version 1 reports import at the boundary. Version 2 records task and grader identity separately. Old R2 evidence keeps its old task version.

Judge faults and unknowns stay incomplete. They do not count as Agent failures. Judge output, native trace, version, usage, cleanup and judgment digest stay in a separate directory. Task costs and judge costs remain separate.

Create a review file keyed by case and repeat:

```json
{
  "H1:1": {
    "completion": "pass",
    "review": {
      "reviewer": "Reviewer name",
      "evidence": "Both replies distinguish Shanghai now and Beijing last year. Cited entries contain the original statements."
    }
  }
}
```

Regrade offline. The command verifies file digests and creates a new report. It makes no model calls and does not operate the browser or routines.

```sh
pnpm exec node apps/cli/src/eval-tasks.ts --trace /path/run/report.json --review /path/review.json
```

`--output` selects the new report path. The original remains intact. Exit codes: `0` all planned trials passed; `1` completed grading contains a task failure; `2` invalid input, environment failure, judge fault or incomplete coverage. Incomplete coverage takes priority over known task failures.

## Compare

Prepare two clean Git checkouts with dependencies installed. The current evaluator loads each target's `openChat`. Both targets use the same external task definitions and graders. Fresh trials alternate A/B and B/A for each planned pair.

```sh
pnpm exec node apps/cli/src/eval-tasks.ts --before /path/old --after /path/new --max-tokens 1000000 --max-batch-tokens 20000000
pnpm exec node apps/cli/src/eval-tasks.ts --trace /path/before/report.json --compare /path/after/report.json
```

Keep model, CLI, OS, account, authorization, effort, browser mode, budgets, task set and grader fixed. Record the intended product change in the experiment report. Provider aliases and remote caches can vary. Keep failures; extra runs do not replace them.

Comparison uses an explicit `--factor`: `code`, `model`, `harness` or `combination`. Code comparisons require different commits and fixed model settings. Model comparisons allow a changed model at the same commit. Harness comparisons require native evidence of the same underlying model. Combination comparisons permit changed Harness/model settings at the same commit.

Use `--experiment /path/experiment.json` to define two configurations. It shares the existing alternating runner and records an experiment plan and dispatch order:

```json
{
  "factor": "combination",
  "before": {"target": "/path/current", "config": {"provider": "codex", "model": "gpt-6.1-terra", "options": {"effort": "low"}}},
  "after": {"target": "/path/current", "config": {"provider": "pi", "model": "deepseek/deepseek-flash", "options": {"thinkingLevel": "low"}}}
}
```

Comparison rejects dirty versions, incomplete batches, undeclared condition changes, changed task/grader digests and unknown native versions. CLI version equality applies to code/model experiments. It lists per-task successes, regressions, review gaps and separate known costs. Three repeats reveal variation; small differences need more preplanned trials. Independent reports do not prove interleaved execution. Configuration support does not establish compatibility with every combination.

## CI

`pnpm test:ci evals` checks reference and incorrect results, report completeness, comparison conditions, fixture behavior, cleanup paths and existing Memory/Computer/Trace contracts. Pure eval changes run this suite, lint, type checking and CI-selection tests. Other changes retain normal checks. Paid model runs use explicit local commands and do not run on each PR.

Specs stay local under `spec/`. PR descriptions contain the goal, scope and verification results for independent review.

The [first baseline](task-evals-baseline-2026-11-25.md) records 48 real trials, failures, review gaps and cleanup totals.
