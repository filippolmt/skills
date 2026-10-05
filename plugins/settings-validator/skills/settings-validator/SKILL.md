---
name: settings-validator
description: Validate or design a Claude Code settings.json (managed, user or project) against the official docs and JSON schema. Use when the user pastes or names a settings.json, managed settings or the admin console configuration, or asks to check or write one.
---

# Validate or design a Claude Code settings.json

Deliver a **verdict** on the file (errors, warnings, best practice, each with its
source) and the **complete corrected JSON**, written for the right **scope**:
organization or single user.

## 1. Scope and intent

Ask with `AskUserQuestion` when available, in rounds of up to four questions
with concrete options, and only what the request leaves open: a pasted file
already answers the starting point.

**Round 1**:

- **scope**: *organization* (managed settings: admin console, file or MDM),
  *user*, or *project*
- **starting point**: an existing file (ask the user to paste it; for user or
  project scope you may read it yourself if the user prefers), or **from
  scratch**
- **environment**: macOS, Linux or a Docker container
- **who uses it**: one person, a team, CI

**Round 2**, the key questions; from scratch they are the whole design, on an
existing file ask only those the file leaves open:

- **use**: everyday development, infrastructure and production access, CI and
  automation, exploration
- **posture**: *strict* (deny by default, sandbox without escape), *balanced*
  (sandbox with escape, prompts on risky actions), *permissive* (few prompts)
- **permission mode**: `default`, `acceptEdits`, `auto` or `plan`, each with
  what it means for prompts
- **must never happen** (multi-select): secrets read (SSH keys, cloud
  credentials, `.env`, kubeconfig), commands outside the sandbox, unapproved
  plugins or marketplaces, bypass permissions mode

**Round 3**, only for the areas the user wants configured:

- plugins and marketplaces: which to enforce, which to allow, auto-update
- model: default and fallback
- commit and PR attribution, language, UI

Done when you know the scope, the starting point, the posture, and a goal for
every area the file touches or the answers call for. An area the user declines
to decide keeps its current value, or its default from scratch.

## 2. Sources

Read on every run: keys change often and memory goes stale.

- `https://code.claude.com/docs/en/settings`: scopes and precedence
- `https://code.claude.com/docs/en/settings-reference`: every key with its scope
  (`Any file`, `Managed`), default and an example
- the schema `https://json.schemastore.org/claude-code-settings.json`
- for the areas touched, the pages the reference links: `permissions`,
  `sandboxing`, `managed-settings`, `server-managed-settings`, `plugins/org`,
  `plugin-marketplaces`
- **secondary source** for best practice:
  `https://github.com/shanraisshan/claude-code-best-practice/blob/main/best-practice/claude-settings.md`
  (read it with `gh api` or `WebFetch`). It is a third-party copy and may lag:
  where it disagrees with the official docs, the docs win, and the disagreement
  is reported.

Done when every page covering a key in the file, or an area the answers call
for, has been read.

## 3. Validation

From scratch there is no file yet: skip to step 4, and run this step on the
draft before delivering it.

1. Run [`scripts/check.py`](scripts/check.py) on the JSON saved to a temp file:
   `python3 <skill dir>/scripts/check.py <file>`.
   It reports `SYNTAX`, `DUP`, `SCHEMA` and `UNKNOWN`; `UNKNOWN` is weighed in
   [`references/best-practice.md`](references/best-practice.md). Exit 2 means
   the check did not run:
   - `jsonschema` missing: install it into a temp directory as the script says
   - schema not loaded: fetch the schema URL another way (`curl`, `WebFetch`)
     into a file and rerun with `--schema <file>`

   A check that never ran is reported as such: the verdict says the schema
   was not checked, never that the file is clean.
2. Check every key against the reference:
   - **scope**: a `Managed` key in a user or project file is ignored
   - **values**: types, enums, limits (e.g. `fallbackModel` takes at most 3
     entries)
   - **deprecated or renamed keys**

Done when every key has been checked against reference and schema, and
`check.py` ran and is clean or every line it reports is explained.

## 4. Best practice

Apply [`references/best-practice.md`](references/best-practice.md) and the
secondary source to every area touched, measured against the goals from step 1.
A best practice that contradicts a stated goal becomes a warning with its risk,
not an imposed fix.

Then look for the **gaps**: keys absent from the file that serve a stated goal
(a `deny` rule, a sandbox exception, a hook, an `env` value, a model default).
Walk the settings reference area by area against the goals; propose each gap
with what it buys, what it costs, and a recommendation. Where two valid
configurations trade off against a goal, ask the user rather than pick.

Done when every area touched has a judgement (compliant, or the proposed change
with its reason) and every goal has either a key serving it or a stated reason
none is needed.

## 5. Delivery

- **Verdict**, in three groups: errors, warnings, best practice. Per item: the
  key, the problem, the source (docs page or schema), and whether it is a
  verified fact or an inference.
- **The complete corrected JSON**, never a fragment: the user pastes it whole.
  From scratch, write only keys
  that serve an answer: a key restating its default adds nothing to maintain.
- Below the JSON, what you changed and what you left alone on purpose.
- *Organization*: the JSON to paste into the console, plus how to confirm it
  applies (`/status`, the `Setting sources` line). *User* or *project*: write
  the file only after the user's yes, and look at what it holds first.

Done when `check.py` is clean on the delivered JSON, or each remaining line is
an accepted trade-off named in the verdict, and every verdict item names its
source.
