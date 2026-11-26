---
name: actions-failure-triage
description: Triage failing GitHub Actions checks on one or more pull requests, grouping failed jobs by error signature so each cause is inspected once. Use when the user asks why GitHub Actions runs or pull request checks fail.
---

# GitHub Actions failure triage

Find the causes behind failed GitHub Actions jobs while reading as little log as
possible: one **signature** per cause, one full inspection per signature. The
`gh` skill owns `gh` syntax (JSON output, repo targeting, pagination); load it
for any command this skill does not spell out.

`<skill dir>/scripts/signatures.py` is the tool for the signal and the grouping;
run it with `python3`.

## 1. Failed jobs

List the failed checks of every pull request in scope with structured output
(`gh pr checks <pr> --json name,workflow,bucket,link`). Keep the checks whose
`bucket` is `fail` and whose `link` holds `/actions/runs/`: those are GitHub
Actions jobs, and the `link` ends in `/job/<id>`, the job id.

Done when every failed job of every pull request in scope is listed with its
pull request, workflow, job name, id and link.

## 2. Signal per job

For each failed job, read only its failure signal:

```bash
gh run view --job <id> --log-failed | python3 <skill dir>/scripts/signatures.py extract
```

`--log-failed` returns the job's whole log; `extract` reduces it to the failing
step's last lines with secrets masked, so only that reaches your context.

Done when every job from step 1 carries a `signal`; a job whose signal is empty
is a step 4 inspection on its own.

## 3. Group

Write the jobs as a JSON array of `{"id", "pr", "workflow", "job", "url",
"signal"}` and group them:

```bash
python3 <skill dir>/scripts/signatures.py group < jobs.json
```

Each group is one signature: same workflow, same job, same signal once
run-specific noise is masked. Its `inspect` job is the **representative**;
`jobs` and `prs` are everything that shares it.

Done when every job from step 1 sits in exactly one group.

## 4. Inspect each representative

For each group, read the representative's full log through the same masking:

```bash
gh run view --job <id> --log-failed | python3 <skill dir>/scripts/signatures.py redact
```

Find the cause: the failing command, the first error, and what changed (the
pull request diff, a dependency, the runner image, a flaky external service).
Quote log text to the user only from `extract` or `redact` output.

The other jobs of the group are confirmed by their matching signal: open their
logs only when the representative's cause plainly cannot explain one of them,
and then treat that job as a new group.

Done when every group has a cause backed by a quoted log line, or is marked
unresolved with what you read and what is missing.

## 5. Report

One section per cause, most pull requests affected first:

- the cause, with the log line that shows it;
- the affected pull requests and jobs, each with its run link;
- exceptions: jobs that looked alike but failed differently;
- the fix, or the next check that would settle the cause.

Finish with the jobs you could not read (permissions, expired logs) and the
groups left unresolved.
