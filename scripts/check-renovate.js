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

const root = path.join(__dirname, '..');
const renovate = JSON.parse(fs.readFileSync(path.join(root, 'renovate.json'), 'utf8'));
const mkPath = path.join(root, '.claude-plugin', 'marketplace.json');
const mkText = fs.readFileSync(mkPath, 'utf8');
const mk = JSON.parse(mkText);

const expected = (mk.plugins || []).filter(
  (p) => p.source && p.source.source === 'git-subdir'
).length;

// EVERY customManager counts, not just the first: the entry shape is split
// across two of them by `ref` (a branch -> git-refs, a tag -> github-tags), and
// they are only a guard TOGETHER. Reading one alone reports the other's entries
// as uncovered — which is exactly what this check is supposed to detect, so the
// false alarm is indistinguishable from the real fault.
const managers = (renovate.customManagers || []).filter((m) => Array.isArray(m.matchStrings));
if (!managers.length) {
  console.error('renovate.json: no customManager with matchStrings found');
  process.exit(1);
}

// Track WHERE each match starts, not just how many there are: an entry claimed by
// two managers and an entry claimed by none cancel out in a plain count, and the
// uncovered entry is the failure mode this guard exists for.
const offsets = [];
for (const manager of managers) {
  for (const pattern of manager.matchStrings) {
    const re = new RegExp(pattern, 'g');
    for (const m of mkText.matchAll(re)) offsets.push(m.index);
  }
}

const matched = new Set(offsets).size;
if (matched !== offsets.length) {
  console.error(
    `${offsets.length - matched} marketplace entr${offsets.length - matched === 1 ? 'y is' : 'ies are'} ` +
      'matched by more than one customManager in renovate.json — two managers would ' +
      'fight over the same sha. Narrow the regexes so each entry has exactly one.'
  );
  process.exit(1);
}

if (matched !== expected) {
  console.error(
    `Renovate regex matches ${matched} entr${matched === 1 ? 'y' : 'ies'} but ` +
      `marketplace.json has ${expected} git-subdir entr${expected === 1 ? 'y' : 'ies'}.\n` +
      'The customManager matchStrings in renovate.json is out of sync with the ' +
      'entry shape — sha auto-bumps will silently stop. Fix the regex.'
  );
  process.exit(1);
}

console.log(`Renovate regex matches all ${expected} git-subdir entries.`);
