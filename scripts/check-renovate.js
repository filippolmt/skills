#!/usr/bin/env node
// check-renovate — guard the implicit seam between renovate.json's customManager
// regex and the external entry shape in marketplace.json.
//
// Renovate bumps each pinned `sha` by matching entries with a regex in
// renovate.json. If the entry shape changes and the regex is not updated in
// lockstep, matching silently drops to zero and auto-updates stop with no error.
// This asserts the regex matches EXACTLY the external entries — run in CI. It also
// rejects the two entry shapes that do not install what they say: a git-subdir
// `path` at the repo root, and a url entry carrying a `path`.
//
// Usage: node scripts/check-renovate.js   (exit 1 on mismatch)

const fs = require('fs');
const path = require('path');
const { readCatalog, isGitSubdir, isUrl, isExternal, isRepoRoot, root } = require('./catalog.js');

// Pure: the message this guard exists to print, or null when the regexes cover the
// catalog exactly. Split from the file reading because the guard's own failure mode
// is SILENCE — a broken regex matches nothing, and a guard broken the same way
// reports nothing — so running it only against a tree that happens to pass is not a
// check. Taking the catalog and the parsed renovate.json as arguments is what lets
// check-renovate.test.js hand it a tree that FAILS.
//
// `catalog` is `{ text, plugins }` from readCatalog(): the regexes are matched
// against the file as written, because that is what Renovate itself matches.
const externalCount = (catalog) => catalog.plugins.filter(isExternal).length;
const entries = (n) => `entr${n === 1 ? 'y' : 'ies'}`;

function coverageError(catalog, renovate) {
  const expected = externalCount(catalog);

  // EVERY customManager counts, not just the first: the entry shape is split
  // across two of them by `ref` (a branch -> git-refs, a tag -> github-tags), and
  // they are only a guard TOGETHER. Reading one alone reports the other's entries
  // as uncovered — which is exactly what this check is supposed to detect, so the
  // false alarm is indistinguishable from the real fault.
  const managers = (renovate.customManagers || []).filter((m) => Array.isArray(m.matchStrings));
  if (!managers.length) return 'renovate.json: no customManager with matchStrings found';

  // Track WHERE each match starts, not just how many there are: an entry claimed by
  // two managers and an entry claimed by none cancel out in a plain count, and the
  // uncovered entry is the failure mode this guard exists for.
  const offsets = [];
  for (const manager of managers) {
    for (const pattern of manager.matchStrings) {
      const re = new RegExp(pattern, 'g');
      for (const m of catalog.text.matchAll(re)) offsets.push(m.index);
    }
  }

  const matched = new Set(offsets).size;
  if (matched !== offsets.length) {
    const over = offsets.length - matched;
    return `${over} marketplace entr${over === 1 ? 'y is' : 'ies are'} ` +
      'matched by more than one customManager in renovate.json — two managers would ' +
      'fight over the same sha. Narrow the regexes so each entry has exactly one.';
  }

  if (matched !== expected) {
    return `Renovate regex matches ${matched} ${entries(matched)} but ` +
      `marketplace.json has ${expected} external ${entries(expected)}.\n` +
      'The customManager matchStrings in renovate.json is out of sync with the ' +
      'entry shape — sha auto-bumps will silently stop. Fix the regex.';
  }

  return null;
}

// Pure: the message naming every entry whose shape misstates what Claude Code
// installs, or null. A git-subdir `path` at the repo root is sparse-checked-out
// in cone mode, so only the top-level files land: no skills, agents or hooks, and
// `claude plugin validate` passes it. A url entry is cloned whole, so a `path` on
// it is ignored and only misleads the next author
// (docs/adr/0033-a-repo-root-plugin-is-a-url-entry.md).
function entryShapeError(plugins) {
  const rooted = plugins.filter((e) => isGitSubdir(e) && isRepoRoot(e.source.path)).map((e) => e.name);
  const pathed = plugins.filter((e) => isUrl(e) && e.source.path !== undefined).map((e) => e.name);
  const errors = [];
  if (rooted.length) {
    errors.push(`git-subdir ${entries(rooted.length)} rooted at the repo root: ${rooted.join(', ')}.\n` +
      'Claude Code installs only the top-level files of such an entry. Use ' +
      '{ "source": "url", "url", "ref", "sha" } with no `path` instead (ADR-0033).');
  }
  if (pathed.length) {
    errors.push(`url ${entries(pathed.length)} with a \`path\`: ${pathed.join(', ')}.\n` +
      'Claude Code ignores `path` on a url source and installs the whole repo. Drop ' +
      'it, or use git-subdir for a subfolder (ADR-0033).');
  }
  return errors.length ? errors.join('\n') : null;
}

module.exports = { coverageError, entryShapeError };

if (require.main === module) {
  const catalog = readCatalog();
  const renovate = JSON.parse(fs.readFileSync(path.join(root, 'renovate.json'), 'utf8'));

  // Both checks run: a shape error must not hide a coverage error until the next run.
  const errors = [entryShapeError(catalog.plugins), coverageError(catalog, renovate)].filter(Boolean);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }

  // The count, not just "ok": zero entries and zero matches also passes, and that
  // is the one green worth being able to spot.
  console.log(`Renovate regex matches all ${externalCount(catalog)} external entries.`);
}
