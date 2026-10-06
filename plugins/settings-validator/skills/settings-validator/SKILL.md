---
name: settings-validator
description: Validate or design Claude Code managed, user, shared-project, or project-local settings against the official docs and JSON schema. Use when the user pastes or names settings.json, settings.local.json, managed settings, or an admin-console configuration, or asks to check or write one.
---

# Validate or design a Claude Code settings.json

Deliver a **verdict** on the file (errors, warnings, best practice, each with its
source) and the **complete corrected JSON** for the right settings source.

## 1. Scope and intent

Ask with `AskUserQuestion` when available, in rounds of up to four questions
with concrete options, and only what the request leaves open: a pasted file
already answers the starting point.

**Round 1**:

- **settings source**: *managed*, *user*, *shared project*
  (`.claude/settings.json`), or *project local* (`.claude/settings.local.json`);
  for *managed*, also the **delivery**: admin console (server-managed), MDM, or
  `managed-settings.json` file
- **starting point**: an existing file (ask the user to paste it; for a local
  file you may read it yourself if the user prefers), or **from scratch**
- **environment**: OS and runtime, including WSL, container or CI constraints
- **who uses it**: one person, a team, CI, or cloud sessions

**Round 2**, the key questions; from scratch they are the whole design, on an
existing file ask only those the file leaves open:

- **use**: everyday development, infrastructure and production access, CI and
  automation, exploration
- **posture**: *strict* (deny by default, sandbox without escape), *balanced*
  (sandbox with escape, prompts on risky actions), *permissive* (few prompts)
- **permission mode**: recommend a currently documented mode, state its prompt
  behavior and risk, and ask for confirmation; the Manual label uses the
  `default` config value
- **must never happen** (multi-select): secrets read (SSH keys, cloud
  credentials, `.env`, kubeconfig), commands outside the sandbox, unapproved
  plugins or marketplaces, bypass permissions mode

**Round 3**, only for the areas the user wants configured:

- plugins and marketplaces: which to enforce, which to allow, auto-update
- model: default and fallback
- commit and PR attribution, language, UI

Done when you know the settings source, the starting point, the posture, and a
goal for every area the file touches or the answers call for. An area the user
declines to decide keeps its current value, or its default from scratch.

## 2. Sources

Read on every run: keys change often and memory goes stale. Download each
docs page as raw Markdown and read a key's type, enum, default and scope from
its own `` ### `<key>` `` section (nested keys use the dotted path):

```bash
curl -sfL https://code.claude.com/docs/en/<page>.md -o <tmp>/<page>.md
```

A summarizing fetch (`WebFetch`) reads only the first 100 KB of the 400 KB
reference and returned wrong types, enums and defaults: use it to find pages,
never as the source of a key's facts.

- `https://code.claude.com/docs/en/settings`: scopes and precedence
- `https://code.claude.com/docs/en/settings-reference`: every key with its scope
  (`Any file`, `Managed`), default and an example
- the schema `https://json.schemastore.org/claude-code-settings.json`
- for the areas touched, the pages the reference links: `permissions`,
  `sandboxing`, `managed-settings`, `server-managed-settings`, `plugins/org`,
  `plugins/loading`, `plugins/host-marketplace`, `plugin-marketplaces`
- **secondary source** for best practice, a third-party copy that may lag:

  ```bash
  gh api repos/shanraisshan/claude-code-best-practice/contents/best-practice/claude-settings.md --jq .content | base64 -d
  gh api 'repos/shanraisshan/claude-code-best-practice/commits?path=best-practice/claude-settings.md&per_page=1' --jq '.[0].commit.committer.date'
  ```

  Where it disagrees with the official docs, the docs win and the disagreement
  is reported; the known ones are under *Secondary-source errata* in
  [`references/best-practice.md`](references/best-practice.md).

Done when every page covering a key in the file, or an area the answers call
for, has been read, and you hold the secondary source's last commit date.

## 3. Validation

From scratch there is no file yet: skip to step 4, and run this step on the
draft before delivering it.

1. Run [`scripts/check.py`](scripts/check.py) on the JSON saved to a temp file,
   with the reference downloaded in step 2:

   ```bash
   uv run <skill dir>/scripts/check.py <file> --reference <tmp>/settings-reference.md
   ```

   `uv run` installs `jsonschema` from the script's header; without `uv`, use
   `python3` and, if `jsonschema` is missing, install it as the script says.
   It reports `SYNTAX`, `DUP`, `SCHEMA` and `UNKNOWN`, the last tagged
   `(documented)` or `(undocumented)`; weigh each `UNKNOWN` as
   [`references/best-practice.md`](references/best-practice.md) says. Exit 2
   means the check did not run; when the schema did not load, fetch its URL
   with `curl` into a file and rerun with `--schema <file>`.

   A check that never ran is reported as such: the verdict says the schema
   was not checked, never that the file is clean.
2. Check every key against the reference:
   - **scope**: confirm that the chosen settings source supports the key; flag
     global-config keys because they belong in `~/.claude.json`
   - **values**: types, enums and limits
   - **default**: on an existing file, a value equal to the documented default
     is redundant; report it as informational
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
- The secondary source's last commit date, and each disagreement with the
  official docs.
- *Managed*: the JSON for its delivery, and which other managed sources it
  overrides (*Managed settings* in
  [`references/best-practice.md`](references/best-practice.md)). Once the user confirms it is deployed, verify each changed key
  yourself with the probes in
  [`references/verify-managed.md`](references/verify-managed.md), and hand the
  user only the checks the CLI cannot make. *User*, *shared project*, or
  *project local*: write the file only after the user's yes, and read its
  current contents first.

Done when `check.py` is clean on the delivered JSON, or each remaining line is
an accepted trade-off named in the verdict; every verdict item names its
source; and, for managed settings the user deployed, every changed key is
verified or listed as a manual check.
