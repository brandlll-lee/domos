# Memory verification

For repeated file, history, browser and routine tasks, see [Task evals](task-evals.md).

Memory uses the existing Durable store, shared product tools and native Harness adapters. The full chat archive remains the evidence source. The chat index is rebuildable. There is no semantic index or synonym dictionary.

## Rule regression

Run on Node 24 or later:

```sh
pnpm test packages/agent/test/memory.test.ts packages/agent/test/memory-eval.test.ts packages/agent/test/work.test.ts packages/agent/test/harness-lifecycle.test.ts packages/agent/test/harness-recovery.test.ts apps/api/test/work.test.ts
```

These public-behavior tests cover in-place corrections, original evidence, forged references, private Bot boundaries, shared facts with private evidence, stale writes after deletion and reopen, silent review saves and skips, missing provenance and tool saves before later task failure. Native lifecycle fixtures verify that the next task receives changed memory while retaining its compatible native process. CI runs these tests through the existing Vitest suites. They require no paid model.

## Browser acceptance

```sh
pnpm build
pnpm exec playwright test apps/web/test/bot-details.spec.ts
```

The memory case reads two automatically saved memories, follows an original message, deletes a record, kills the service and reopens its database. It verifies the retained result, dark and light themes and a narrow window. The fixture calls the real service and RPC boundary.

## Native Agent evaluation

The runner creates a temporary data directory, Bot and work directory for each case. It uses normal `Runtime.submit`, memory/history tools, native model discovery and the saved work computer's CLI account. It does not use the user's Domos database. The restart case kills the worker after a committed checkpoint and opens the same temporary database.

Inspect the installed Harness catalog first. Pass an exact reported model ID. Native options are dynamic too.

```sh
pnpm eval:memory --harness codex --catalog
pnpm eval:memory --harness codex --model gpt-6.1-terra --options '{"effort":"low"}' --max-tokens 400000 --output memory-report.json
pnpm eval:memory --harness pi --catalog
pnpm eval:memory --harness opencode --catalog
```

The model IDs above are examples from a verified local catalog, not runner defaults. Other users select their installed, authenticated Harness and supported model. Catalog presence does not prove the provider will accept a request. The runner never silently substitutes another model or account.

Use `--case city|paraphrase|manual|deletion|restart|isolation` for one case. `--seconds` defaults to 150 per worker. Expiry uses the normal Stop path. A parent process terminates a stuck worker after an additional 30 seconds. `--max-tokens` defaults to 250000 per case. Token checks use reported totals after each completed turn, including cache reads; they cannot cap a native request already in progress. Reported cost remains unknown when the provider has no usable amount or price. A token budget is not a currency budget.

The process uses full native approval so model tools can run unattended. Temporary data isolates Domos state; it is not an OS sandbox. Native tools still have the work computer's account and file permissions. Run only the fixed, reviewed questions in a suitable OS account. Gold rules live in the runner and are not sent to the subject, but same-user native file access is not a hard anti-cheating boundary. Use an isolated OS account or container when evaluating untrusted agents.

## Reports and offline scoring

Each report records its suite version, Git commit, dirty state, Harness/model/options, budgets, times, CLI version, native evidence, exact tool arguments/results, answers, final memories, original IDs, usage and retained database path. Failures retain available evidence. Reports can contain private source text; share only sanitized artifacts.

The six Chinese cases cover in-place current versus historical residence, paraphrase retrieval, manual preference protection, deleted facts, crash persistence and private Bot isolation. Deterministic rules check state, references, successful retrieval and leak markers. They do not establish semantic answer correctness or universal isolation. Review the actual Chinese answers and source quotes separately.

```sh
pnpm eval:memory --trace memory-report.json --output memory-scored.json
```

Offline scoring performs no inference. A failed execution remains failed even when its retained state passes some rules. Exit 0 requires passing rules, successful execution and a passing review for every answer. Exit 1 reports a rule, execution or reviewed task failure. Exit 2 reports invalid data, configuration, runner failure or answers awaiting review. The saved report distinguishes these states.

Offline imports validate the executed cases and grading fields. A case must contain a valid result or a recorded failure. Missing results cannot pass grading.

Read three results separately: CI rule regression, offline trajectory rules and manually reviewed real task success. New `memory-3` reports store `result.answers`: one question per item, with `prompt`, `requestId`, `turnId`, `taskId` and original answer `messages` (`entryId`, `messageId`, `text`). Missing identities remain null. All original source pages are read. Tool calls retain IDs and references to their original call and result entries in the retained database. Structured results and attachments stay in those original records.

Review the question and its actual answers against original evidence. In a copy of the report, set each answer's `completion` to `pass` or `fail` and add `review: { "reviewer": "your name", "evidence": "the observed result and original record or file reference" }`. Then run the existing offline scoring command. Do not edit prompts, answers or execution results. The scorer derives `score.answerReview` and report `taskSuccess`; execution failure still returns failure. Reports with all rules passing but a wrong answer must receive a failing task review. New answers default to `unreviewed`. Retained reports with a single `answer` remain scoreable, but their missing question boundaries and reviews remain unknown.

There is no implicit model judge or judge cost. Inspect execution, native errors and budget failures before attributing failure to a model. Native provider rejection and missing login are environment issues. The report preserves native errors rather than guessing their cause.

Keep the keyword baseline. Add a rebuildable semantic index only after a versioned set of real questions shows important missed retrievals and a controlled comparison improves them. Track correctness, evidence accuracy, unintended writes, latency and reported subject usage separately.
