#!/usr/bin/env python3
"""Group failed GitHub Actions jobs by error signature, so each cause is inspected once.

Usage:
  gh run view --job <id> --log-failed | signatures.py extract
    Prints only the failure signal: the failing step's last output lines up to each
    ##[error] (error-looking lines when there is none), secrets masked, at most 20
    lines. This is the "signal" a job carries below.
  gh run view --job <id> --log-failed | signatures.py redact
    Prints the log with the same secret masking, for a full inspection.
  signatures.py group < jobs.json
    jobs.json: [{"id", "pr", "workflow", "job", "url", "signal"}, ...]
    Prints the groups as JSON, first-seen order: {"workflow", "job", "signature",
    "inspect": {"id", "pr", "url"}, "jobs": [ids], "prs": [numbers]}.
    Same workflow + job + signal once run-specific noise is masked → one group.
"""
import json
import re
import sys

# Run-specific noise that differs between identical failures.
NOISE = [
    (re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?"), "<time>"),
    (re.compile(r"/tmp/[\w.-]+"), "/tmp/<tmp>"),
    (re.compile(r"\b[0-9a-f]{7,40}\b"), "<sha>"),
    (re.compile(r"\b\d+(\.\d+)?\s?(ms|s|m)\b"), "<duration>"),
    (re.compile(r"\b\d{5,}\b"), "<n>"),
]


SIGNAL = re.compile(r"\b(error|exception|fail(ed|ure)?|panic|traceback)\b", re.I)
PASSING = re.compile(r"^(\u2714|\u2713|\u2139|ok\b|PASS\b)")
SECRETS = [
    (re.compile(r"\b(Bearer|Basic)\s+[^\s'\"]+", re.I), r"\1 ***"),
    (re.compile(r"\b(gh[pousr]_|github_pat_)\w+"), "***"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "***"),
    # KEY=value and key: value, env-style names included (AWS_SECRET_ACCESS_KEY, NPM_TOKEN).
    (re.compile(r"\b(\w*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\w*)(\s*[=:]\s*)[^\s'\"]+", re.I),
     r"\1\2***"),
    (re.compile(r"(://[^/\s:@]+):[^/\s@]+@"), r"\1:***@"),
]
PREFIX = re.compile(r"^(?:[^\t]*\t){2}(?:\d{4}-\d{2}-\d{2}T\S+ ?)?")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
STEP_TAIL = 10
MAX_LINES = 20


def messages(log):
    # --log-failed prefixes "<job>\t<step>\t<timestamp> ": keep the message.
    for line in log.splitlines():
        yield ANSI.sub("", PREFIX.sub("", line)).strip()


def redact(text):
    for pattern, mask in SECRETS:
        text = pattern.sub(mask, text)
    return text


def extract(log):
    """The failing step's output up to each ##[error], else error-looking lines; secrets masked."""
    picked, step, in_group, marked = [], [], False, False
    for message in messages(log):
        if message.startswith("##[group]"):
            in_group, step = True, []
        elif message.startswith("##[endgroup]"):
            in_group = False
        elif message.startswith("##[error]"):
            marked = True
            picked += step[-STEP_TAIL:] + [message]
            step = []
        elif not in_group and message:
            step.append(message)
    if not marked:
        picked = [m for m in messages(log) if SIGNAL.search(m) and not PASSING.match(m)]
    out = []
    for message in map(redact, picked):
        if message not in out:
            out.append(message)
    return out[-MAX_LINES:]


def signature(signal):
    lines = []
    for line in signal.splitlines():
        for pattern, mask in NOISE:
            line = pattern.sub(mask, line)
        line = line.strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def group(jobs):
    groups = {}
    for job in jobs:
        # An empty signal shares no evidence with another: keyed by its own id.
        key = (job["workflow"], job["job"], signature(job["signal"]) or f"<no signal: {job['id']}>")
        g = groups.get(key)
        if g is None:
            g = groups[key] = {
                "workflow": key[0], "job": key[1], "signature": key[2],
                "inspect": {"id": job["id"], "pr": job.get("pr"), "url": job.get("url")},
                "jobs": [], "prs": [],
            }
        g["jobs"].append(job["id"])
        if job.get("pr") is not None and job["pr"] not in g["prs"]:
            g["prs"].append(job["pr"])
    return list(groups.values())


def main(argv):
    if argv[1:] == ["extract"]:
        print("\n".join(extract(sys.stdin.read())))
        return 0
    if argv[1:] == ["redact"]:
        sys.stdout.write(redact(sys.stdin.read()))
        return 0
    if argv[1:] == ["group"]:
        json.dump(group(json.load(sys.stdin)), sys.stdout, indent=2)
        print()
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
