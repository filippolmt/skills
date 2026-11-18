#!/usr/bin/env node
// Self-check for check-renovate.js. Run: node scripts/check-renovate.test.js
//
// This guard's failure mode is silence: a regex that stops matching reports
// nothing, and neither does a guard broken the same way. So the cases below are
// trees that FAIL — running it against the live repo (as CI does) only ever shows
// the passing shape, which is the one case that proves nothing.
const assert = require('assert');
const { coverageError, entryShapeError, orphanRuleError, cliPinError } = require('./check-renovate.js');

// Two git-subdir entries pinned the two ways renovate.json splits on — a branch
// `ref` and a tag `ref` — a url entry (a plugin that is its whole repo, ADR-0033),
// which carries no `path` and must be claimed all the same, plus a local plugin,
// which no manager should claim.
const TEXT = `{
  "plugins": [
    { "name": "branch-pinned", "source": { "source": "git-subdir", "url": "https://github.com/o/r", "path": "skills/a", "ref": "main", "sha": "aaaaaaa" } },
    { "name": "tag-pinned", "source": { "source": "git-subdir", "url": "https://github.com/o/r", "path": "skills/b", "ref": "skill-v1.2.3", "sha": "bbbbbbb" } },
    { "name": "whole-repo", "source": { "source": "url", "url": "https://github.com/o/whole", "ref": "v2.0.0", "sha": "ccccccc" } },
    { "name": "local-plugin", "source": "./plugins/local" }
  ]
}`;
// Parsed from the same text the regexes run against, so the fixture cannot drift
// from itself.
const CATALOG = { text: TEXT, plugins: JSON.parse(TEXT).plugins };

const BRANCH = '"ref": "(?:main|master)", "sha": "(?<currentDigest>[^"]+)"';
const TAG = '"ref": "[a-z-]*v[0-9][^"]*", "sha": "(?<currentDigest>[^"]+)"';
const managers = (...matchStrings) => ({ customManagers: matchStrings.map((m) => ({ matchStrings: [m] })) });

// --- covered: the two managers together claim every external entry, and the
// local plugin is not expected to be claimed by either ---
assert.strictEqual(coverageError(CATALOG, managers(BRANCH, TAG)), null,
  'both managers together cover every external entry');

// --- the failure this guard exists for: one manager's shape stops matching, so
// its entries silently drop out of Renovate's reach ---
let err = coverageError(CATALOG, managers(BRANCH));
assert.match(err, /matches 1 entry but/, 'the uncovered entries are counted');
assert.match(err, /has 3 external entries/, 'against the number that should be covered');
assert.match(err, /auto-bumps will silently stop/, 'and says what breaks');

// --- and the opposite, which is also both faults at once: the branch entry is
// claimed twice and the tag entry not at all. Two offsets against two expected
// entries, so a plain count calls this covered and only the offsets tell them
// apart — the reason this guard tracks WHERE each match starts. ---
err = coverageError(CATALOG, managers(BRANCH, BRANCH));
assert.match(err, /1 marketplace entry is matched by more than one customManager/,
  'the double claim is reported, not cancelled out against the uncovered one');
assert.match(err, /fight over the same sha/, 'and says why that is bad');

// --- no usable manager at all: a renovate.json with none, and one whose entry
// carries no matchStrings array to read ---
assert.match(coverageError(CATALOG, {}), /no customManager with matchStrings found/,
  'an empty renovate.json is a failure, not a pass');
assert.match(coverageError(CATALOG, { customManagers: [{ description: 'no matchStrings' }] }),
  /no customManager with matchStrings found/, 'a manager without matchStrings is not a manager');

// --- the url entry alone: a manager that still demands a `path` misses it ---
const WITH_PATH = '"path": "[^"]+", "ref": "[a-z-]*v[0-9][^"]*", "sha": "(?<currentDigest>[^"]+)"';
assert.match(coverageError(CATALOG, managers(BRANCH, WITH_PATH)), /matches 2 entries but/,
  'a tag regex requiring `path` drops the url entry');

// --- a git-subdir entry rooted at the repo root installs EMPTY: Claude Code
// sparse-checks-out `path` in cone mode, so `.` brings only the top-level files
// (ADR-0033). Such an entry must be a url entry instead. ---
const rooted = (p) => ({ name: `rooted-${p}`, source: { source: 'git-subdir', url: 'https://github.com/o/r', path: p, ref: 'main', sha: 'a' } });
assert.strictEqual(entryShapeError(CATALOG.plugins), null, 'no rooted git-subdir entry => no error');
for (const p of ['.', './', '', '/']) {
  err = entryShapeError([...CATALOG.plugins, rooted(p)]);
  assert.match(err, new RegExp(`rooted-${p.replace(/[./]/g, '\\$&')}`), `path ${JSON.stringify(p)} is named`);
  assert.match(err, /"source": "url"/, 'and the fix is named');
}
assert.strictEqual(entryShapeError([rooted('plugin'), rooted('.claude/skills/x')]), null,
  'a real subdirectory, dotted or not, is fine');

// --- a url entry carrying a `path`: Claude Code ignores it and installs the whole
// repo, so the field only misleads the next author into thinking it narrows it ---
const urlWithPath = { name: 'url-with-path', source: { source: 'url', url: 'https://github.com/o/r', path: 'plugin', ref: 'main', sha: 'a' } };
err = entryShapeError([...CATALOG.plugins, urlWithPath]);
assert.match(err, /url-with-path/, 'the url entry with a path is named');
assert.match(err, /ignores `path`/, 'and why it is wrong');

// --- a catalog with no external entries at all: nothing to cover, and the
// managers matching nothing is then correct ---
const localOnly = { text: '{"plugins":[{"name":"x","source":"./plugins/x"}]}', plugins: [{ name: 'x', source: './plugins/x' }] };
assert.strictEqual(coverageError(localOnly, managers(BRANCH, TAG)), null,
  'no external entries => zero matches is the right answer');

// --- a packageRule whose package no entry pins: Renovate drops it silently, so a
// renamed source would lose its tag exclusion. Both package-name forms are pins ---
const rules = (...names) => ({ packageRules: [{ matchPackageNames: names }, { automerge: true }] });
assert.strictEqual(orphanRuleError(CATALOG, rules('o/r', 'https://github.com/o/whole')), null,
  'owner/repo and repo-URL names of pinned sources are not orphans');
assert.match(orphanRuleError(CATALOG, rules('o/r', 'o/gone')), /o\/gone/, 'the orphan is named');
assert.doesNotMatch(orphanRuleError(CATALOG, rules('o/r', 'o/gone')), /o\/r,/, 'and only the orphan');

// --- harness CLIs the CI installs globally: each must be pinned, so a run is
// reproducible, and claimed by exactly one manager, so Renovate keeps it current
// (ADR-0047). A floating install is the silent version of a stale pin. ---
const wf = (...lines) => ({ file: '.github/workflows/v.yml', text: `jobs:\n  t:\n    steps:\n${lines.map((l) => `      - run: ${l}\n`).join('')}` });
const NPM = 'npm install (?:-g|--global) (?<depName>@[a-z0-9-]+/[a-z0-9-]+)@(?<currentValue>\\d+\\.\\d+\\.\\d+)';
const cliManager = (pattern = NPM, files = '/^\\.github/workflows/[^/]+\\.ya?ml$/') =>
  ({ customManagers: [{ managerFilePatterns: [files], matchStrings: [pattern] }] });
const PIN = 'npm install --global @e/pi@1.0.4';

err = cliPinError([wf('npm install -g @a/claude')], cliManager());
assert.match(err, /@a\/claude/, 'the unpinned CLI is named');
assert.match(err, /\.github\/workflows\/v\.yml/, 'with the file it is installed in');
assert.match(err, /unpinned/, 'and the fault');

assert.strictEqual(cliPinError([wf(PIN)], cliManager()), null, 'a pinned CLI a manager claims is fine');
assert.strictEqual(cliPinError([wf(PIN, PIN)], cliManager()), null, 'two installs, each claimed once: fine');
assert.strictEqual(cliPinError([wf(`${PIN} && pi --version`)], cliManager()), null,
  'a command chained after the install is not a package');
assert.strictEqual(cliPinError([wf('npm ci')], cliManager()), null, 'a local install is not checked');

// --- the global flag in every position and spelling npm accepts: missing one
// lets an unpinned install through without a word ---
for (const line of ['npm install @a/claude -g', 'npm i --location=global @a/claude',
  'npm install --location global @a/claude', 'npm add -g @a/claude && echo done']) {
  assert.match(cliPinError([wf(line)], cliManager()) || '', /@a\/claude is unpinned/, `${line}: read as a global install`);
}
err = cliPinError([wf('npm install -g "@a/claude"')], cliManager());
assert.match(err, /@a\/claude is unpinned/, 'a quoted spec is read without its quotes');
err = cliPinError([{ file: '.github/workflows/v.yml', text: '      run: |\n        npm install -g \\\n          @a/claude\n' }], cliManager());
assert.match(err, /@a\/claude is unpinned/, 'a spec on a continuation line is read');
assert.doesNotMatch(err, /\\ is unpinned/, 'and the backslash is not a package');
assert.strictEqual(cliPinError([wf('echo ok # npm install -g @a/claude')], cliManager()), null,
  'a commented-out install is not an install');

// --- the silent failure: pinned, but no manager reaches it, so it stays at that
// version forever. Three ways to get there: no manager at all, a manager whose
// file pattern misses the workflow, a manager whose regex misses the line. ---
for (const [renovate, why] of [
  [{}, 'no manager'],
  [cliManager(NPM, '/^\\.github/actions/.+$/'), 'a file pattern that misses the workflow'],
  [cliManager(NPM.replace('(?:-g|--global)', '-g')), 'a regex that misses the line'],
]) {
  err = cliPinError([wf(PIN)], renovate);
  assert.match(err, /@e\/pi@1\.0\.4/, `${why}: the pin is named`);
  assert.match(err, /no Renovate customManager/, `${why}: and the fault`);
}

// --- claimed twice: two managers would open competing bump PRs for one pin ---
const twice = { customManagers: [...cliManager().customManagers, ...cliManager().customManagers] };
err = cliPinError([wf(PIN)], twice);
assert.match(err, /@e\/pi@1\.0\.4/, 'the doubly claimed pin is named');
assert.match(err, /more than one customManager/, 'and the fault');

// --- a double claim and a missing one must not cancel out: the first install is
// claimed twice, the second (`npm i`, which the regex misses) by none ---
err = cliPinError([wf(PIN, 'npm i --global @e/pi@1.0.4')], twice);
assert.match(err, /more than one customManager/, 'the double claim is reported');
assert.match(err, /no Renovate customManager/, 'and so is the unclaimed install');
// ...nor may a matching comment stand in for the install it sits above.
err = cliPinError([{ file: '.github/workflows/v.yml', text: `# ${PIN}\n      run: npm i -g @e/pi@1.0.4\n` }],
  cliManager());
assert.match(err, /no Renovate customManager/, 'a claim on a comment does not cover the real install');

err = cliPinError([wf(PIN)], cliManager(NPM, '**/*.yml'));
assert.match(err, /\*\*\/\*\.yml is not a \/regex\//, 'a managerFilePatterns form this check cannot read is reported');

console.log('ok');
