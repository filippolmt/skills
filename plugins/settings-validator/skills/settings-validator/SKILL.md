---
name: settings-validator
description: Validates, improves or designs a Claude Code settings.json (organization or single user) against the official docs and JSON schema, fills the gaps the user's goals call for, and returns the corrected JSON. Use when the user pastes or names a settings.json, managed settings or the admin console configuration, or asks to check or design one.
---

# Validate or design a Claude Code settings.json

Deliver a **verdict** on the file (errors, warnings, best practice, each with its
source) and the **complete corrected JSON**, written for the right **scope**:
organization or single user.

## 1. Scope and intent

Ask with `AskUserQuestion` when available, in rounds of up to four questions
with concrete options; wait for each round before the next.

**Round 1**, always:

- **scope**:
  - *organization*: managed settings from the claude.ai admin console, a
    `managed-settings.json` or MDM; applies to everyone and nothing overrides it
  - *user*: `~/.claude/settings.json`
  - *project*: shared `.claude/settings.json`, or `.claude/settings.local.json`
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

Done when you know the scope, the starting point, the posture, and an intent for
every area the file touches or the answers call for. An area the user declines
to decide keeps its current value, or its default from scratch.

## 2. Sources

Read on every run: keys change often and memory goes stale.

- `https://code.claude.com/docs/en/settings`: scopes and precedence
- `https://code.claude.com/docs/en/settings-reference`: every key with its scope
  (`Any file`, `Managed`), default and an example
- the schema `https://json.schemastore.org/claude-code-settings.json`
- for the areas touched, the pages the reference links: `permissions`,
  `sandboxing`, `managed-settings`, `server-managed-settings`, `plugins/org`
- **secondary source** for best practice:
  `https://github.com/shanraisshan/claude-code-best-practice/blob/main/best-practice/claude-settings.md`
  (read it with `gh api` or `WebFetch`). It is a third-party copy and may lag:
  where it disagrees with the official docs, the docs win, and the disagreement
  is reported.

Done when every page covering a key present in the file, or proposed, has been
read.

## 3. Validation

1. Run [`scripts/check.py`](scripts/check.py) on the JSON saved to a temp file:
   `python3 <skill dir>/scripts/check.py <file>`.
   It reports `SYNTAX`, `DUP`, `SCHEMA` and `UNKNOWN`. Without the `jsonschema`
   module (exit 2), install it into a temp directory as the script says and
   rerun. `UNKNOWN` matters: the schema accepts extra top-level keys, but the
   claude.ai admin console flags them with a generic schema-error warning that
   names no key.
2. Check every key against the reference:
   - **scope**: a `Managed` key in a user or project file is ignored
   - **values**: types, enums, limits (e.g. `fallbackModel` takes at most 3
     entries)
   - **deprecated or renamed keys**

Done when every key in the file has been checked against reference and schema,
and `check.py` is clean or every line it reports is explained.

## 4. Best practice

Apply [`references/best-practice.md`](references/best-practice.md) and the
secondary source to every area touched, measured against the intent from step 1.
A best practice that contradicts a stated intent becomes a warning with its risk,
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
  Run it through `check.py` before delivering. From scratch, write only keys
  that serve an answer: a key restating its default adds nothing to maintain.
- Below the JSON, what you changed and what you left alone on purpose.
- *Organization*: the JSON to paste into the console, plus how to confirm it
  applies (`/status`, the `Setting sources` line). *User* or *project*: write
  the file only after the user's yes, and look at what it holds first.
