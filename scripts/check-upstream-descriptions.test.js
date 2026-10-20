#!/usr/bin/env node
// Self-check for check-upstream-descriptions.js. Run: node scripts/check-upstream-descriptions.test.js
//
// The network half only fetches two files; what can go wrong silently is which
// sha counts as reviewed and what counts as a changed description, so those run
// here against fake histories and fake upstream text.
const { test } = require('node:test');
const assert = require('node:assert');
const { descriptionOf, reviewedShas, findings } = require('./check-upstream-descriptions.js');

const entry = (name, sha, description) => ({
  name, description,
  source: { source: 'git-subdir', url: `https://github.com/acme/${name}`, path: 'x', ref: 'v1.0.0', sha },
});
const commit = (bot, ...plugins) => ({ bot, plugins });

test('descriptionOf reads a manifest, else the frontmatter block with its continuation lines', () => {
  assert.strictEqual(descriptionOf({ manifest: '{"name":"p","description":"Does p."}' }), 'Does p.');
  assert.strictEqual(descriptionOf({ skill: '---\nname: s\ndescription: Does s.\n---\n# S' }), 'description: Does s.');
  // A folded description differs in its continuation lines only; both must show.
  const folded = (tail) => `---\nname: s\ndescription: >\n  Does s\n  ${tail}\nlicense: MIT\n---\n`;
  assert.notStrictEqual(descriptionOf({ skill: folded('fast.') }), descriptionOf({ skill: folded('slowly.') }));
  assert.strictEqual(descriptionOf({ skill: '# no frontmatter' }), null);
  assert.strictEqual(descriptionOf({}), null);
});

test('the reviewed sha is the last one a human commit set or rewrote; Renovate bumps do not count', () => {
  const shas = reviewedShas([
    commit(false, entry('a', 's1', 'A'), entry('b', 's1', 'B')),
    commit(true, entry('a', 's2', 'A'), entry('b', 's2', 'B')),   // Renovate bump
    commit(false, entry('a', 's2', 'A2'), entry('b', 's2', 'B')),  // a rewritten at s2, b untouched
    commit(true, entry('a', 's3', 'A2'), entry('b', 's3', 'B')),
    commit(false, entry('a', 's4', 'A2'), entry('b', 's3', 'B')),  // human bump of a, same text
  ], {});
  assert.deepStrictEqual(shas, new Map([['a', 's4'], ['b', 's1']]));
});

test('an acknowledgement in catalog-meta overrides the history', () => {
  const shas = reviewedShas([commit(false, entry('a', 's1', 'A')), commit(true, entry('a', 's2', 'A'))], { a: 's2' });
  assert.strictEqual(shas.get('a'), 's2');
});

test('an entry first added by a bot has no reviewed sha and is not reported', () => {
  assert.deepStrictEqual(reviewedShas([commit(true, entry('a', 's1', 'A'))], {}), new Map());
});

test('findings: a changed upstream description is reported; unchanged, unreviewed or unreadable is not', async () => {
  const catalog = [entry('a', 's2', 'A'), entry('b', 's2', 'B'), entry('c', 's2', 'C'), entry('d', 's2', 'D'), entry('e', 's1', 'E')];
  const reviewed = new Map([['a', 's1'], ['b', 's1'], ['d', 's1'], ['e', 's1']]);
  const upstream = new Map([
    ['a@s1', 'old'], ['a@s2', 'new'],
    ['b@s1', 'same'], ['b@s2', 'same'],
    ['d@s1', null], ['d@s2', 'new'],
  ]);
  const lines = await findings(catalog, reviewed, async (e, sha) => upstream.get(`${e.name}@${sha}`));
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].split('\n')[0], '- `a` (`acme/a`): upstream description changed between `s1` (reviewed) and `s2` (pinned)');
  // The texts a review decides on travel with the finding, fenced so a `<name>` survives Markdown.
  for (const text of ['Catalog', '```text\nA\n```', 'Upstream at `s1`', '```text\nold\n```', 'Upstream at `s2`', '```text\nnew\n```']) {
    assert.ok(lines[0].includes(text), `the finding carries ${text}:\n${lines[0]}`);
  }
  assert.match(lines[0], /<details>[\s\S]*<\/details>\s*$/);
});
