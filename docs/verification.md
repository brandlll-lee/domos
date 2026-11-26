# Verification

Use Node 24, as specified by `.node-version`. Run `pnpm install` to install dependencies and the repository Git hook.

## Before a commit

Stage the intended files, then run:

```sh
pnpm verify --plan
pnpm verify
```

The plan compares the index with `HEAD`. Verification exports that index to a temporary directory and runs its own check definitions. Unstaged files do not enter the check. Temporary source and dependencies are removed when the command finishes or fails.

Local verification retains passing web-file evidence in the Git directory. It reuses a result only when the product and shared test inputs, dependencies, commands, Node version, platform, test file and its snapshots match. A failed run retains evidence for its passing files. Changed, failed or missing files run again. Zero tests, skipped tests, missing reports and abnormal process exits cannot establish passing evidence. CI runs its selected checks in its own environment.

## Before a push

Use `git push` normally. `.githooks/pre-push` runs `pnpm verify --push` for each updated ref. It compares the remote tip with the local commit and checks that commit in a temporary directory. A new ref checks its complete tree. Version tags select full validation. Deleting a ref needs no code checks.

The push gate runs the selected `check` job: verification contracts, lint, type checking and the selected unit tests. Browser, desktop, packaging, native and sandbox jobs run in CI. The hook prints the pending jobs. Run `pnpm verify` explicitly to perform the selected local jobs before pushing.

The hook is installed by the root `prepare` script. The current repository setting can be read with:

```sh
git config --local --get core.hooksPath
```

It must return `.githooks`.

## CI

`.github/ci.mjs` owns change selection, test files, build commands and arguments. CI passes its Git selection to the same `pnpm verify --job <name>` entry. Workflow files provide operating systems, display services, sandbox prerequisites, shards and artifact uploads. Vitest uses two workers. Browser and desktop suites use their existing single-worker configuration.

For the same base, tree and execution platform, local and CI plans must match. A push containing several commits uses the remote tip as its base. It can therefore select more checks than a single staged commit.

Node mismatch, failed commands, terminated processes and missing requested checks return failure. Local verification runs the jobs supported by its host and lists other jobs as pending CI. Linux owns sandbox verification. Windows owns desktop packaging. An explicit `--job` request fails on an incompatible host. A successful local check permits the push; it does not complete the CI gate. The CI result requires every selected job to succeed for the same commit.

## Regression evidence

`.github/verify.test.mjs` checks plan coverage, process failures, staged snapshots and real pushes to a temporary local remote. It compares local and CI plans and confirms that a failed check leaves the remote tip unchanged.

`apps/web/test/drafts.spec.ts` delays the actual IndexedDB write before checking attachment removal across reload. `.github/desktop-startup.test.mjs` observes Electron readiness before and after the official test connection starts.

Historical fault injection runs only in temporary copies. Keep its failure reason and restored result in the local specification evidence. Do not retain faulty product implementations.
