#!/usr/bin/env node
// Self-check for check-name-collisions.js. Run: node scripts/check-name-collisions.test.js
//
// The checker's whole value is catching a shape that once shipped, so the first
// case IS that shape: a checker that only ever agrees with the current tree would
// pass CI forever and guard nothing.
const assert = require('assert');
const { findCollisions } = require('./check-name-collisions.js');

const leaves = (found) => found.map((c) => c.leaf).sort();

// --- the defect this exists for: mode-router 0.8.0 owned commands/handoff.md
// while the catalog also shipped an unrelated `handoff` skill. ---
let found = findCollisions({
  entries: [{ name: 'mode-router', dir: 'mode-router' }, { name: 'handoff', dir: null }],
  artifacts: [
    { leaf: 'handoff', kind: 'command', owner: 'mode-router', file: 'plugins/mode-router/commands/handoff.md' },
    { leaf: 'mode-router', kind: 'skill', owner: 'mode-router', file: 'plugins/mode-router/skills/mode-router/SKILL.md' },
  ],
});
assert.deepStrictEqual(leaves(found), ['handoff'], 'the historical collision is caught');
assert.match(found[0].against, /catalog entry/, 'and named against what took it');

// --- and the same tree after the rename is clean ---
found = findCollisions({
  entries: [{ name: 'mode-router', dir: 'mode-router' }, { name: 'handoff', dir: null }],
  artifacts: [
    { leaf: 'carryover', kind: 'command', owner: 'mode-router', file: 'x' },
    { leaf: 'mode-router', kind: 'skill', owner: 'mode-router', file: 'y' },
  ],
});
assert.deepStrictEqual(found, [], 'the rename clears it');

// --- self-exemption is by DIRECTORY, not by name. A plugin's own skill sharing
// its entry name is how `mode-router:mode-router` is reached; the exemption must
// not stretch to an entry that merely happens to be called the same thing. ---
found = findCollisions({
  entries: [{ name: 'twin', dir: 'other-plugin' }],
  artifacts: [{ leaf: 'twin', kind: 'skill', owner: 'twin', file: 'z' }],
});
assert.deepStrictEqual(leaves(found), ['twin'], "another plugin's entry is not exempted by a matching owner name");

// --- two local plugins racing for one name: no catalog entry involved ---
found = findCollisions({
  entries: [],
  artifacts: [
    { leaf: 'deploy', kind: 'command', owner: 'alpha', file: 'plugins/alpha/commands/deploy.md' },
    { leaf: 'deploy', kind: 'skill', owner: 'beta', file: 'plugins/beta/skills/deploy/SKILL.md' },
  ],
});
assert.deepStrictEqual(leaves(found), ['deploy'], 'local artifacts collide with each other too');
assert.match(found[0].against, /skills\/deploy\/SKILL\.md/, 'and point at the rival file');

// One plugin owning both a command and a skill by one name is its own business:
// it resolves to one of them, but nothing else is shadowed by it.
found = findCollisions({
  entries: [],
  artifacts: [
    { leaf: 'same', kind: 'command', owner: 'alpha', file: 'a' },
    { leaf: 'same', kind: 'skill', owner: 'alpha', file: 'b' },
  ],
});
assert.deepStrictEqual(found, [], 'one plugin, one name, no cross-plugin shadowing');

// --- a project skill belongs to no plugin, so no entry is ever its own ---
found = findCollisions({
  entries: [{ name: 'triage', dir: null }],
  artifacts: [{ leaf: 'triage', kind: 'project skill', owner: null, file: '.claude/skills/triage/SKILL.md' }],
});
assert.deepStrictEqual(leaves(found), ['triage'], 'a project skill is exempted from nothing');

console.log('ok');
