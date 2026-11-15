// Offline checks: node --test scripts/check-sha-history.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { movedPins, historyErrors } = require('./check-sha-history.js');

const entry = (name, sha, repo = 'acme/skills') => ({
  name, source: { source: 'git-subdir', url: `https://github.com/${repo}`, path: `skills/${name}`, ref: 'v1.0.0', sha },
});

test('only external entries on both sides with a changed sha in the same repo move', () => {
  const base = [entry('kept', 'a'), entry('moved', 'a'), entry('removed', 'a'), entry('rehomed', 'a', 'old/repo'),
    { name: 'local', source: './plugins/local' }];
  const head = [entry('kept', 'a'), entry('moved', 'b'), entry('added', 'c'), entry('rehomed', 'b', 'new/repo'),
    { name: 'local', source: './plugins/local' }];
  assert.deepEqual(movedPins(base, head), [{ name: 'moved', repo: 'acme/skills', from: 'a', to: 'b' }]);
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
