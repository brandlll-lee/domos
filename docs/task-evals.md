# Task evals

The task suite measures real Domos outcomes. It uses the installed Codex CLI and `gpt-6.1-terra` with low effort. Scripts check objective results. People review semantic results. A successful tool call alone does not establish success.

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

Use Node 24 or newer. Log in with the work computer's Codex CLI first. Each trial checks the native model catalog. An unavailable model stops the batch. Each trial has separate Bot data, working directories, native sessions and browser profiles. The user account stays in the existing Harness configuration.

Start with one case from each group:

```sh
pnpm exec node apps/cli/src/eval-tasks.ts --cases F1,H1,B1,R1 --repeats 1 --max-batch-tokens 1000000
```

Run the baseline with three repeats:

```sh
pnpm exec node apps/cli/src/eval-tasks.ts --max-tokens 1000000 --max-batch-tokens 20000000
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

F4, H1–H4 and B4 need semantic review. Check every reply against the exact input and expected result. Read cited original entries. A review cannot override failed objective checks or replace original messages.

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

`--output` selects the new report path. The original remains intact. Exit codes: `0` all planned trials passed; `1` recorded failure; `2` invalid input or incomplete/unreviewed coverage. Read execution failures, objective checks and semantic review separately.

## Compare

Prepare two clean Git checkouts with dependencies installed. The current evaluator loads each target's `openChat`. Both targets use the same external task definitions and graders. Fresh trials alternate A/B and B/A for each planned pair.

```sh
pnpm exec node apps/cli/src/eval-tasks.ts --before /path/old --after /path/new --max-batch-tokens 20000000
pnpm exec node apps/cli/src/eval-tasks.ts --trace /path/before/report.json --compare /path/after/report.json
```

Keep model, CLI, OS, account, authorization, effort, browser mode, budgets, task set and grader fixed. Record the intended product change in the experiment report. Provider aliases and remote caches can vary. Keep failures; extra runs do not replace them.

Comparison rejects dirty versions, equal commits, incomplete batches and changed conditions, suite digest or native CLI versions. It lists per-task successes, regressions, review gaps and known costs. Three repeats reveal variation; small differences require more preplanned paired trials. Independent reports do not prove interleaved execution. New eval code establishes a baseline; it does not establish improved Agent behavior.

## CI

`pnpm test:ci evals` checks reference and incorrect results, report completeness, comparison conditions, fixture behavior, cleanup paths and existing Memory/Computer/Trace contracts. Pure eval changes run this suite, lint, type checking and CI-selection tests. Other changes retain normal checks. Paid model runs use explicit local commands and do not run on each PR.

Specs stay local under `spec/`. PR descriptions contain the goal, scope and verification results for independent review.
