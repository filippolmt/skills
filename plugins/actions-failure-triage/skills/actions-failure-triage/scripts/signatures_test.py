#!/usr/bin/env python3
"""signatures.py through its CLI, as the skill runs it: run with python3."""
import json
import os
import subprocess
import sys

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signatures.py")


def run(*args, stdin):
    done = subprocess.run(
        [sys.executable, "-B", SCRIPT, *args], input=stdin, capture_output=True, text=True, check=True
    )
    return done.stdout


def plan(jobs):
    return json.loads(run("group", stdin=json.dumps(jobs)))


def job(job_id, signal, pr=1, workflow="CI", name="test"):
    return {"id": job_id, "pr": pr, "workflow": workflow, "job": name,
            "url": f"https://github.com/o/r/actions/runs/1/job/{job_id}", "signal": signal}


# Three PRs failing the same way, differing only in timestamps, run ids and temp paths:
# one inspection, every job accounted for in that one group.
same = plan([
    job(11, "2026-11-26T10:00:01.123Z ##[error]Process completed with exit code 1.\n"
            "FAIL src/a.test.ts > parses /tmp/tmp.Ab12Cd/x after 1234ms", pr=1),
    job(22, "2026-11-26T11:42:09.001Z ##[error]Process completed with exit code 1.\n"
            "FAIL src/a.test.ts > parses /tmp/tmp.Zz99Yy/x after 87ms", pr=2),
    job(33, "2026-11-27T08:15:30.500Z ##[error]Process completed with exit code 1.\n"
            "FAIL src/a.test.ts > parses /tmp/tmp.Qq00Ww/x after 5ms", pr=3),
])
assert [g["inspect"]["id"] for g in same] == [11], same
assert sorted(same[0]["jobs"]) == [11, 22, 33], same
assert sorted(same[0]["prs"]) == [1, 2, 3], same

# Two distinct signatures: two inspections, one per group.
mixed = plan([
    job(11, "##[error]FAIL src/a.test.ts > parses"),
    job(22, "##[error]FAIL src/a.test.ts > parses", pr=2),
    job(33, "##[error]npm ERR! code ERESOLVE", name="build"),
])
assert sorted(g["inspect"]["id"] for g in mixed) == [11, 33], mixed
assert len(mixed) == 2, mixed

# Same error text in a different job is a different signature: jobs differ in setup.
split = plan([job(11, "##[error]boom", name="lint"), job(22, "##[error]boom", name="test")])
assert len(split) == 2, split

def raw(stamp, *messages):
    # Real `--log-failed` lines from this repo's regenerate/tree job: it prints the nested
    # validate run's step summary (✓ passed, X failed, - skipped) before its own error.
    return "\n".join(f"tree\tUNKNOWN STEP\t{stamp} {m}" for m in messages)


# Same cause (the ADR-0014 check), different step-tail windows and annotation blocks:
# jobs 138200837003 and 138114484960. One group.
tree = plan([
    job(138200837003, run("extract", stdin=raw(
        "2026-11-24T03:47:53.0537042Z",
        "  ✓ Check external entry shapes and Renovate regex coverage",
        "  X Check every external repo is classified in ADR-0014",
        "  - Check no local command or skill name is already taken",
        "  - Validate marketplace and plugins",
        "  - Lint GitHub workflows",
        "  - Post Run actions/setup-node@v7",
        "  ✓ Post Run actions/checkout@v7",
        "  ✓ Complete job",
        "",
        "ANNOTATIONS",
        "X Process completed with exit code 1.",
        "validate: .github#7",
        "",
        "##[error]Process completed with exit code 1.",
    )), workflow="regenerate", name="tree"),
    job(138114484960, run("extract", stdin=raw(
        "2026-11-24T00:18:33.6553225Z",
        "  ✓ Resolve every catalog path at its pinned sha",
        "  ✓ Refuse a pinned sha moved off its history",
        "  ✓ Check external entry shapes and Renovate regex coverage",
        "  X Check every external repo is classified in ADR-0014",
        "  - Check no local command or skill name is already taken",
        "  - Validate marketplace and plugins",
        "  - Lint GitHub workflows",
        "  - Post Run actions/setup-node@v7",
        "  ✓ Post Run actions/checkout@v7",
        "  ✓ Complete job",
        "##[error]Process completed with exit code 1.",
    )), workflow="regenerate", name="tree"),
])
assert len(tree) == 1, tree

# Counters and uppercase hex differ between same-cause runs: one group.
counted = plan([
    job(11, "Tests: 3 failed, 41 passed\nFAIL suite ABCDEF1234 > parses"),
    job(22, "Tests: 4 failed, 40 passed\nFAIL suite 9F8E7D6C5B > parses"),
])
assert len(counted) == 1, counted

# Distinct causes stay apart, even when they share a heading and the generic exit line.
causes = plan([
    job(11, "Curated sources and curation baselines disagree (ADR-0039):\n"
            "- `Jeffallan/claude-skills`: curated source with no catalog entry\n"
            "##[error]Process completed with exit code 1."),
    job(22, "Curated sources and curation baselines disagree (ADR-0039):\n"
            "- `antfu/skills`: curated source with no curation baseline\n"
            "##[error]Process completed with exit code 1."),
    job(33, "npm ERR! code E404\n##[error]Process completed with exit code 1."),
    job(44, "npm ERR! code ERESOLVE\n##[error]Process completed with exit code 1."),
    # Only the generic exit line: no evidence to share, its own inspection.
    job(55, "##[error]Process completed with exit code 1."),
    job(66, "##[error]Process completed with exit code 2."),
])
assert len(causes) == 6, causes

# An empty signal shares no evidence: each such job is its own inspection.
blank = plan([job(11, ""), job(22, "")])
assert sorted(g["inspect"]["id"] for g in blank) == [11, 22], blank

# extract: `gh run view --log-failed` text in, only the failure signal out, secrets masked.
def log(*lines):
    # `gh run view --log-failed` shape: "<job>\t<step>\t<timestamp> <message>"; the step is
    # often "UNKNOWN STEP" and the whole job log comes back, passing steps included.
    return "\n".join(f"test\tUNKNOWN STEP\t2026-11-26T10:00:{i:02d}.000Z {line}" for i, line in enumerate(lines))


LOG = log(
    "##[group]Run npm test",
    "\x1b[36;1mnpm test\x1b[0m",
    "##[endgroup]",
    "\u2714 behind and diverged fail, ahead and identical pass (0.3ms)",
    "\u2139 fail 0",
    "##[group]Run node scripts/check.js",
    "\x1b[36;1mnode scripts/check.js\x1b[0m",
    "shell: /usr/bin/bash -e {0}",
    "##[endgroup]",
    "Curated sources and curation baselines disagree:",
    "- fetch https://api.example.com rejected Authorization: Bearer abc.def-ghi",
    "  token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 password=hunter2 key AKIAABCDEFGHIJKLMNOP",
    "##[error]Process completed with exit code 1.",
    "##[group]Post job cleanup",
    "Removing credentials config",
    "##[endgroup]",
)
signal = run("extract", stdin=LOG)
# The failing step's own output, ending at its error; earlier steps' passing lines are not signal.
assert signal.splitlines() == [
    "Curated sources and curation baselines disagree:",
    "- fetch https://api.example.com rejected Authorization: Bearer ***",
    "token=*** password=*** key ***",
    "##[error]Process completed with exit code 1.",
], signal
for secret in ("abc.def-ghi", "ghp_", "hunter2", "AKIA"):
    assert secret not in signal, (secret, signal)

# No ##[error] marker (a cancelled or truncated log): fall back to error-looking lines,
# still skipping lines that report passing tests.
bare = run("extract", stdin=log("\u2714 retries after a failed fetch (5ms)", "ok 3 - parse", "Error: ENOENT: no such file, open 'x'"))
assert bare.splitlines() == ["Error: ENOENT: no such file, open 'x'"], bare

# redact: any log text, every common secret form masked, the error itself kept.
redacted = run("redact", stdin="\n".join([
    "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY",
    "OPENAI_API_KEY=sk-proj-abc123 NPM_TOKEN=npm_abc123",
    "password: hunter2",
    "git clone https://deploy:pa55w0rd@example.com/r.git",
    "SyntaxError: Unexpected token ) in JSON at position 4",
]))
for secret in ("wJalrXUtnFEMI", "sk-proj-abc123", "npm_abc123", "hunter2", "pa55w0rd"):
    assert secret not in redacted, (secret, redacted)
assert "Unexpected token ) in JSON" in redacted, redacted

# However long the log, the output stays bounded.
noisy = run("extract", stdin="\n".join(f"x\ty\t##[error]failure {i}" for i in range(500)))
assert len(noisy.splitlines()) <= 20, len(noisy.splitlines())

print("ok")
