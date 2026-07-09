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

const manager = (renovate.customManagers || []).find((m) => Array.isArray(m.matchStrings));
if (!manager) {
  console.error('renovate.json: no customManager with matchStrings found');
  process.exit(1);
}

let matched = 0;
for (const pattern of manager.matchStrings) {
  const re = new RegExp(pattern, 'g');
  matched += (mkText.match(re) || []).length;
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
