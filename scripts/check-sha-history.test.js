// Offline checks: node --test scripts/check-sha-history.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { movedPins, compareStatus, historyErrors } = require('./check-sha-history.js');

const entry = (name, sha, repo = 'acme/skills') => ({
  name, source: { source: 'git-subdir', url: `https://github.com/${repo}`, path: `skills/${name}`, ref: 'v1.0.0', sha },
});

test('only external entries on both sides move; a repo change is rehomed, not compared', () => {
  const base = [entry('kept', 'a'), entry('moved', 'a'), entry('removed', 'a'), entry('rehomed', 'a', 'old/repo'),
    { name: 'local', source: './plugins/local' }];
  const head = [entry('kept', 'a'), entry('moved', 'b'), entry('added', 'c'), entry('rehomed', 'b', 'new/repo'),
    { name: 'local', source: './plugins/local' }];
  assert.deepEqual(movedPins(base, head), {
    moves: [{ name: 'moved', repo: 'acme/skills', from: 'a', to: 'b' }],
    rehomed: [{ name: 'rehomed', from: 'old/repo', to: 'new/repo' }],
  });
});

test('behind and diverged fail, ahead and identical pass', async () => {
  const status = { b: 'ahead', c: 'identical', d: 'behind', e: 'diverged' };
  const moves = ['b', 'c', 'd', 'e'].map((to) => ({ name: `to-${to}`, repo: 'acme/skills', from: 'a', to }));
  const errors = await historyErrors(moves, async (_repo, _from, to) => status[to]);
  assert.deepEqual(errors, ['to-d (acme/skills): a -> d is behind', 'to-e (acme/skills): a -> e is diverged']);
});

test('entries sharing one move are compared once', async () => {
  let calls = 0;
  const moves = ['one', 'two'].map((name) => ({ name, repo: 'acme/skills', from: 'a', to: 'b' }));
  await historyErrors(moves, async () => { calls++; return 'ahead'; });
  assert.equal(calls, 1);
});

test('compare 404 (no merge base) reads unrelated; any other error is rethrown', async () => {
  const failing = (status) => async () => { const err = new Error(`GitHub API ${status}`); err.status = status; throw err; };
  assert.equal(await compareStatus(async (url) => ({ status: url.endsWith('/compare/a...b') ? 'ahead' : '?' }), 'acme/skills', 'a', 'b'), 'ahead');
  assert.equal(await compareStatus(failing(404), 'acme/skills', 'a', 'b'), 'unrelated');
  await assert.rejects(compareStatus(failing(503), 'acme/skills', 'a', 'b'), /503/);
});
