#!/usr/bin/env node
// check-renovate — guard the implicit seam between renovate.json's customManager
// regex and the git-subdir entry shape in marketplace.json.
//
// Renovate bumps each pinned `sha` by matching entries with a regex in
// renovate.json. If the entry shape changes and the regex is not updated in
// lockstep, matching silently drops to zero and auto-updates stop with no error.
// This asserts the regex matches EXACTLY the git-subdir entries — run in CI.
//
// Usage: node scripts/check-renovate.js   (exit 1 on mismatch)

const fs = require('fs');
const path = require('path');
const { readCatalog, isGitSubdir, root } = require('./catalog.js');

// Pure: the message this guard exists to print, or null when the regexes cover the
// catalog exactly. Split from the file reading because the guard's own failure mode
// is SILENCE — a broken regex matches nothing, and a guard broken the same way
// reports nothing — so running it only against a tree that happens to pass is not a
// check. Taking the catalog and the parsed renovate.json as arguments is what lets
// check-renovate.test.js hand it a tree that FAILS.
//
// `catalog` is `{ text, plugins }` from readCatalog(): the regexes are matched
// against the file as written, because that is what Renovate itself matches.
const gitSubdirCount = (catalog) => catalog.plugins.filter(isGitSubdir).length;

function coverageError(catalog, renovate) {
  const expected = gitSubdirCount(catalog);

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
    return `Renovate regex matches ${matched} entr${matched === 1 ? 'y' : 'ies'} but ` +
      `marketplace.json has ${expected} git-subdir entr${expected === 1 ? 'y' : 'ies'}.\n` +
      'The customManager matchStrings in renovate.json is out of sync with the ' +
      'entry shape — sha auto-bumps will silently stop. Fix the regex.';
  }

  return null;
}

module.exports = { coverageError };

if (require.main === module) {
  const catalog = readCatalog();
  const renovate = JSON.parse(fs.readFileSync(path.join(root, 'renovate.json'), 'utf8'));

  const error = coverageError(catalog, renovate);
  if (error) {
    console.error(error);
    process.exit(1);
  }

  // The count, not just "ok": zero entries and zero matches also passes, and that
  // is the one green worth being able to spot.
  console.log(`Renovate regex matches all ${gitSubdirCount(catalog)} git-subdir entries.`);
}
