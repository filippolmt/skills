# Repository audit

Audit of commit `ae3d8841f177fac25548798e808a4ad54dcc36e8`.

## Remediation

All findings below are historical and addressed on `feat/repository-audit`:

- Validated names before writes; rejected native-copy symlinks and attribution
  destination symlinks; repaired failed checkout-cache recovery.
- Preserved upstream notices and enforced licensing for external conversions.
- Planned metadata-aware pruning before writes, with offline CLI removal tests
  covering the sequence requested by #461.
- Fixed all four guard cases and bumped `zsh-wordsplit-guard` to `0.7.2`.
- Covered missing integration inputs and corrected onboarding, glossary, and
  GitHub repository description. Regenerated all distributions.

Regression tests were demonstrated failing before fixes. The complete test runner,
all generator checks, catalog/Claude validation, and pi/Codex installation smokes
pass. Smokes passed both with installed pi `1.4.0` / Codex `0.164.0` and the pinned
minimum pi `1.0.4` / Codex `0.160.1`. Pi loaded 131 skills with bundle filtering;
Codex installed all 92 plugins and passed hook trust/execution, coexistence,
upgrade, and removal checks. This is not a behavioral audit of every upstream skill.

The original findings and audit-time limitations follow unchanged.

## What this repository does

The catalog distributes skills to Claude Code, Codex CLI, and pi. Claude follows upstream references; generators copy and adapt artifacts for Codex and pi. Expected load is a maintainer running generators locally and in GitHub Actions, not a multi-user application server.

Reviewed documentation, GitHub description/open issues/recent runs, generator and distribution paths, local guards, licensing, workflow triggers, and tests. Three parallel reviews were followed by direct reproductions of the staging escape, cache recovery, missing-license conversion, and four guard cases. Fixtures were temporary; no upstream content or installed packages were modified.

## Must fix

### 1. Skill names can escape the generation directory

**Source:** [`buildFromInventory`](../../scripts/gen-skills-tree.js), lines 265–274; [`validateSkillDirectories`](../../scripts/portable-artifacts.js), lines 45–67.

- **What this is:** An upstream `SKILL.md` supplies the directory name used when copying files.
- **Problem:** A frontmatter name `../escaped` writes to a sibling of the staging directory. Final validation inspects the now-empty staging directory and passes. Directly reproduced with an isolated fixture. This is a path-validation defect, not evidence that current upstream skills are malicious.
- **Fix:** Validate every native and converted name before constructing a destination or writing files. Cover both the active inventory builder and the legacy exported builder.
- **If skipped:** An accepted upstream change can write outside the intended output directory during regeneration.

**Regression test:** Invalid names such as `../escaped` must throw before any file is created outside staging; valid names must continue to generate.

### 2. Failed fetches poison the checkout cache

**Source:** [`checkout`](../../scripts/gen-skills-tree.js), lines 160–168.

- **What this is:** Repeated generator commands reuse a temporary checkout per upstream commit.
- **Problem:** The cache is considered complete merely because `.git` exists. A failed fetch leaves that directory behind; a second call returns it without fetching or checking out anything. Directly reproduced using a nonexistent local remote.
- **Fix:** Reuse only a checkout whose `HEAD` matches the requested commit, and clean failed initialization. Do not treat an incomplete cache as evidence of upstream deletion.
- **If skipped:** A transient fetch failure followed by a retry can make valid catalog paths appear deleted and eligible for pruning.

**Regression test:** Fail an initial fetch, then retry against a valid local fixture remote; assert the requested files and commit are present.

### 3. Required upstream attribution is omitted

**Sources:** [`gen-skills-tree.js`](../../scripts/gen-skills-tree.js), lines 270–275; [`addProvenance`](../../scripts/portable-artifacts.js), lines 70–81; [pinned Impeccable notice](https://github.com/pbakaus/impeccable/blob/aeeb3d8c30b5f95aeeb3e893b0f1a308af8fdb8f/NOTICE.md).

- **What this is:** Impeccable distributes iOS and Android reference material derived from ehmo's MIT-licensed `platform-design-skills`.
- **Problem:** Upstream's root `NOTICE.md` carries that attribution, but neither `skills/impeccable` nor its Codex package includes it. Searching both generated directories for `ehmo` or `platform-design-skills` returns no matches, although the derived references are present.
- **Fix:** Preserve applicable upstream notices alongside licenses in both generated distributions. Regenerate rather than hand-editing the copies.
- **If skipped:** Distribution continues to omit upstream third-party attribution. This is a concrete compliance concern, not a legal opinion.

**Regression test:** An upstream fixture with a root license and notice must retain both in pi and Codex outputs.

### 4. Converted commands and agents bypass license refusal

**Sources:** [`buildFromInventory`](../../scripts/gen-skills-tree.js), lines 255–272; [`addProvenance`](../../scripts/portable-artifacts.js), lines 70–72; [ADR-0010](../adr/0010-vendor-a-shared-skills-tree-on-main.md).

- **What this is:** Commands and agents are converted into portable `SKILL.md` files.
- **Problem:** The native-skill branch rejects an external repository without a license; the conversion branch does not. A command-only external fixture without a license successfully generated a skill and provenance file. The existing no-license test covers the legacy builder, not this active path.
- **Fix:** Enforce redistribution eligibility for every external artifact before copying or converting it.
- **If skipped:** Future additions can redistribute content without the license required by the repository's stated policy. Current generated skill directories were checked and have licenses.

**Regression test:** External command-only and agent-only fixtures without licenses must fail in the active builder.

### 5. Pruning can invalidate distribution metadata after modifying the catalog

**Sources:** [`prune` and CLI ordering](../../scripts/gen-skills-tree.js), lines 224–236 and 423–431; [`validateMetadata`](../../scripts/distribution.js), lines 205–216.

- **What this is:** Regeneration removes catalog entries whose pinned upstream paths disappeared.
- **Problem:** The prune plan updates catalog and bundle dependencies but not distribution metadata. A review fixture with removed entry `gone` and `runtimeDependencies: { gone: [] }` passed path verification, then failed normal generation with `orphaned runtime dependency source: gone` after catalog removal. Artifact/unsupported metadata and incoming runtime edges also need explicit handling.
- **Fix:** Plan metadata consequences before writing anything. Remove safe metadata owned by deleted entries and refuse behavior-changing incoming edges before mutating the catalog.
- **If skipped:** A legitimate upstream removal can block regeneration and leave a partially updated working tree.

**Regression test:** Run the real CLI sequence on an offline removal fixture, including distribution metadata. The broader sequence-test gap is already tracked by [issue #461](https://github.com/filippolmt/skills/issues/461); do not create a duplicate.

### 6. Automatic rewriting changes valid heredoc behavior

**Sources:** [`scan.js`](../../plugins/zsh-wordsplit-guard/hooks/scan.js), lines 106–109; [`expansion.js`](../../plugins/zsh-wordsplit-guard/hooks/expansion.js), lines 149–170.

- **What this is:** The guard automatically escapes words beginning with `=`.
- **Problem:** For the command below, it rewrites the heredoc delimiter from `=ls` to `\=ls`. Quoting any part of a heredoc delimiter disables expansion in its body. Original zsh prints `hello world`; rewritten zsh prints literal `hello $N`. Directly reproduced.
- **Fix:** Exclude heredoc delimiter tokens from these literal-word rewrites while retaining the appropriate checks inside expandable bodies.
- **If skipped:** A guard can silently change generated file content or command input.

```sh
N=world; cat << =ls
hello $N
=ls
```

**Regression test:** Add this to the mechanical original-bash versus rewritten-zsh comparisons.

## Should fix

### 7. Three more guard edge cases need targeted tests

**Sources:** [`command.js`](../../plugins/zsh-wordsplit-guard/hooks/command.js), lines 122–136; [`guard.js`](../../plugins/zsh-wordsplit-guard/hooks/guard.js), lines 71–73 and 119–122. All cases directly reproduced.

- **Changed repair meaning:** `DC='echo $HOME'; $DC` prints literal `$HOME` in bash. Suggested function/array repairs expand `$HOME` instead. Keep the safe explicit-split suggestion; avoid interpolating expansion-bearing scalar content into executable repair examples.
- **False positive:** `for c in "1 + 2"; do (( n = $c )); printf "%s\n" "$n"; done` is denied although both shells print `3`. Mask arithmetic contexts as well as `[[ … ]]`.
- **False negative:** `a=(x y); unset a; a="x y"; for x in $a; do printf "<%s>" "$x"; done` passes the guard because it finds an old array assignment. Bash prints `<x><y>` and zsh `<x y>`. Account for intervening `unset`/assignments before granting an array exemption.

**If skipped:** Valid work is blocked, unsafe repairs are suggested, and a known shell mismatch passes undetected. Each case needs one regression test; no general shell-parser rewrite is justified by this audit alone.

### 8. Integration workflows miss real generator inputs

**Sources:** [`pi-integration.yml`](../../.github/workflows/pi-integration.yml), lines 5–32; [`codex-integration.yml`](../../.github/workflows/codex-integration.yml), lines 5–36.

- **What this is:** Path filters decide whether installation smoke tests run on a source PR.
- **Problem:** Both omit `shared/**`, `scripts/catalog.js`, and `LICENSE`; pi also omits `overlays/**`. For example, changing only `shared/subito/annunci.js` skips both workflows even though local skills reference it and generation dereferences it. An overlay-only change skips pi integration.
- **Fix:** Include actual projection inputs in both pull-request and push filters; assert trigger coverage in the existing workflow tests.
- **If skipped:** Changes to shipped content or generator behavior can merge without the corresponding installation smoke test. Post-merge regeneration is not equivalent to source-PR integration coverage.

### 9. README contains three factual onboarding errors

See the separate [onboarding audit](marketplace-onboarding-audit.md) for official documentation, implementation citations, and the isolated pi discovery probe.

1. **A pi checkout does not auto-load root `skills/`.** The table currently says no installation/configuration is needed. Root `skills/` is a package convention directory, not a normal project discovery directory. Use an explicit package load such as `pi -e .`; do not restore the intentionally removed Codex shared-location symlink.
2. **Claude's Bash tool is not universally zsh.** Qualify the shell-dependent guidance. Update the local manifest/catalog description consistently if that text is changed; never hand-edit generated README regions.
3. **External `path` does not always contain `SKILL.md`.** Per-skill entries do; whole-plugin entries point at the plugin root containing `.claude-plugin/plugin.json`.

**If skipped:** Readers receive incorrect installation instructions or reject valid catalog shapes. Existing generated-region checks do not catch manual prose mistakes.

## Nice to have

### 10. Make the first installation choice clearer

**Source:** [onboarding audit](marketplace-onboarding-audit.md).

Add a short three-harness chooser linking to existing sections, label initial `/plugin` examples as Claude Code, and include a final invocation check for Codex (`/skills` or `$`) and pi (`/skill:tdd`). Explain Claude activation/reload and opt-in third-party auto-update rather than implying Renovate refreshes installed copies.

The GitHub description correctly names all three harnesses but blurs reference versus copy distribution and exceptions to one-skill-per-plugin granularity. Suggested replacement, **not applied**:

> Skills for Claude Code, Codex CLI and pi: install individual plugins or workflow bundles; pi uses one package with skill filters. Upstream updates via Renovate.

No new dependency, framework, badge collection, or additional catalog is needed.

## Validation performed

Passed directly in the primary audit session:

- `bash scripts/run-tests.sh` — the complete repository runner, including Node, guard, rewrite, and Python checks.
- `node scripts/gen-readme.js --check`.
- `node scripts/check-renovate.js` — all 89 external entries matched.
- `node scripts/check-name-collisions.js` — 4 local artifacts and 96 catalog entries.
- `claude plugin validate .` — clean, no warnings.
- `node scripts/gen-skills-tree.js --verify-paths` — 89 pinned paths resolved; 96 entries classified.

Passing tests do not invalidate the findings: the listed cases are missing from existing coverage. Recent GitHub pi/Codex integration runs for the audited commit succeeded; validate/regenerate were still running at the initial status read, not assumed green.

## Recommended order

1. Fix generation boundaries and failed-cache recovery, with regression tests.
2. Fix attribution preservation and enforce licenses across conversion paths.
3. Make metadata-bearing pruning safe, extending rather than duplicating #461.
4. Fix heredoc rewriting, then the other isolated guard cases; bump only the changed guard plugin and regenerate as required by repository policy.
5. Close workflow trigger gaps and correct onboarding/description wording.

**Verdict:** The repository has substantial, passing validation, but generator safety and redistribution correctness should come before cosmetic README work.

**Not checked:** Full fresh-install pi/Codex smoke runs in this audit session, live GitHub protection/secrets, every vendored runtime, every upstream license obligation, or all shell syntax. No evidence of current malicious upstream content was established. No code fixes, GitHub metadata changes, issues, commits, or PRs were made; only these research notes were added.
