// Offline checks: node --test scripts/check-upstream-versions.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { audit, missingPaths } = require('./check-upstream-versions.js');
const { tagNames } = require('./check-branch-pins.js');
const entry = (name, ref = 'main', sha = 'pinned', dir = `skills/${name}`) => ({
  name, source: { source: 'git-subdir', url: 'https://github.com/acme/skills', ref, sha, path: dir },
});
const blob = (path) => ({ type: 'blob', path });
const text = (result) => result.lines.join('\n');
function fake({ commits = {}, status = 'ahead', tree = [], fail } = {}) {
  const calls = [];
  const api = async (url) => {
    calls.push(url);
    if (fail && url.includes(fail)) throw new Error('GitHub API 503');
    if (url.includes('/commits/')) {
      const ref = decodeURIComponent(url.split('/commits/')[1]);
      assert.ok(ref in commits, `Unexpected commit request: ${ref}`);
      return { sha: commits[ref] };
    }
    if (url.includes('/compare/')) return { status };
    if (url.includes('/git/trees/')) return { truncated: false, tree };
    throw new Error(`Unexpected request: ${url}`);
  };
  return { api, calls };
}

test('latest tag stays in its own series; multiple refs and digests are audited separately', async () => {
  const { api } = fake({ commits: { 'skill-v4.10.0': 'skill-new', 'cli-v2.0.0': 'cli-current' } });
  const result = await audit([
    entry('one', 'skill-v4.9.0', 'old'), entry('two', 'cli-v2.0.0', 'cli-current'),
    { name: 'local', source: './plugins/local' },
  ], { api, tags: async () => ['v99.0.0', 'skill-v4.9.0', 'skill-v4.10.0', 'cli-v2.0.0'] });
  assert.match(text(result), /\[one\]: stale.*skill-v4.9.0@old -> latest same-series tag skill-v4.10.0@skill-new/);
  assert.match(text(result), /\[two\]: current.*cli-v2.0.0@cli-current/);
  assert.equal(result.attention, true);
});

test('branches resolve the named branch, not default HEAD, and report updated and current pins', async () => {
  const { api } = fake({ commits: { master: 'new', main: 'pinned' } });
  const result = await audit([entry('old', 'master'), entry('current')], { api, tags: async () => [] });
  assert.match(text(result), /\[old\]: stale.*branch HEAD master@new/);
  assert.match(text(result), /\[current\]: current.*branch HEAD main@pinned/);
});

test('a current tag with a drifted digest is stale', async () => {
  const { api } = fake({ commits: { 'v1.0.0': 'rewritten' } });
  const result = await audit([entry('one', 'v1.0.0')], { api, tags: async () => ['v1.0.0'] });
  assert.equal(result.attention, true);
  assert.match(text(result), /stale/);
  assert.match(text(result), /Digest drift/);
});

test('unchanged tag and SHA need no review', async () => {
  const { api } = fake({ commits: { 'v1.0.0': 'pinned' } });
  const result = await audit([entry('one', 'v1.0.0')], { api, tags: async () => ['v1.0.0'] });
  assert.equal(result.attention, false);
  assert.match(text(result), /current/);
});

for (const status of ['ahead', 'identical', 'behind', 'diverged']) {
  test(`branch-to-tag candidate distinguishes ${status} relative to pinned SHA`, async () => {
    const { api, calls } = fake({ commits: { main: 'branch-head', 'v1.0.0': 'release' }, status,
      tree: [blob('skills/one/SKILL.md')] });
    const result = await audit([entry('one')], { api, tags: async () => ['v1.0.0'] });
    assert.match(text(result), new RegExp(`Tag candidate v1.0.0@release: ${status} relative to pinned pinned`));
    assert.ok(calls.includes('repos/acme/skills/compare/pinned...release'));
    assert.equal(calls.some((p) => p.includes('/git/trees/')), ['behind', 'diverged'].includes(status));
  });
}

test('downgrade preflight lists every lost entry, possible moves and no-match losses', async () => {
  const { api } = fake({ commits: { main: 'branch-head', 'v1.0.0': 'release' }, status: 'behind',
    tree: [blob('old/one/SKILL.md'), blob('old/alias/SKILL.md'), blob('skills/kept/SKILL.md')] });
  const result = await audit([entry('alias', 'main', 'pinned', 'skills/one'), entry('gone'), entry('kept')],
    { api, tags: async () => ['v1.0.0'] });
  assert.match(text(result), /3 entries\): 2 absent/);
  assert.match(text(result), /alias: absent skills\/one; possible new locations.*old\/one, old\/alias/);
  assert.match(text(result), /gone: absent skills\/gone; possible new locations.*none/);
  assert.doesNotMatch(text(result), /kept: absent/);
});

test('scoped explicit candidate preflights even an ahead tag and excludes other repos', async () => {
  const { api, calls } = fake({ commits: { main: 'new', 'v1.0.0': 'release' }, tree: [] });
  const other = entry('other');
  other.source.url = 'https://github.com/other/repo';
  const result = await audit([entry('one'), other], { repo: 'acme/skills', tag: 'v1.0.0',
    api, tags: async () => [] });
  assert.match(text(result), /1 entries\): 1 absent/);
  assert.ok(calls.every((url) => url.startsWith('repos/acme/skills/')));
});

test('path preflight accepts whole plugins and url entries, but not empty skill folders', () => {
  const url = entry('root');
  url.source.source = 'url';
  delete url.source.path;
  assert.deepEqual(missingPaths([entry('plugin'), entry('empty'), url], [
    blob('skills/plugin/.claude-plugin/plugin.json'), blob('skills/empty/README.md'),
  ]), [{ name: 'empty', path: 'skills/empty', possibleLocations: [] }]);
});

test('API failures in tags, commits, comparisons and trees reject instead of passing', async () => {
  await assert.rejects(audit([entry('one')], { tags: async () => { throw new Error('tags failed'); } }), /tags failed/);
  for (const fail of ['/commits/', '/compare/', '/git/trees/']) {
    const { api } = fake({ commits: { main: 'new', 'v1.0.0': 'release' }, status: 'behind', fail });
    await assert.rejects(audit([entry('one')], { api, tags: async () => ['v1.0.0'] }), /GitHub API 503/);
  }
});

test('truncated candidate trees and invalid API responses reject', async () => {
  for (const body of [{ truncated: true, tree: [] }, { tree: [] }, { truncated: false }]) {
    const { api: base } = fake({ commits: { main: 'new', 'v1.0.0': 'release' }, status: 'behind' });
    const api = (url) => url.includes('/git/trees/') ? body : base(url);
    await assert.rejects(audit([entry('one')], { api, tags: async () => ['v1.0.0'] }), /preflight incomplete/);
  }
  await assert.rejects(audit([entry('one')], { api: async () => ({}), tags: async () => [] }), /missing commit SHA/);
  const { api } = fake({ commits: { main: 'new', 'v1.0.0': 'release' }, status: 'unknown' });
  await assert.rejects(audit([entry('one')], { api, tags: async () => ['v1.0.0'] }), /invalid comparison/);
});

test('missing series, unsupported refs and unmatched scopes cannot report current', async () => {
  await assert.rejects(audit([entry('one', 'skill-v1.0.0')], { tags: async () => ['cli-v2.0.0'] }), /no release tag/);
  await assert.rejects(audit([entry('one', 'release')], { tags: async () => [] }), /unsupported ref/);
  await assert.rejects(audit([], { repo: 'none/repo' }), /No external entries/);
});

test('shared tag reader paginates all tags and propagates later-page failures', async () => {
  const original = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => url.endsWith('page=1')
        ? Array.from({ length: 100 }, (_, i) => ({ name: `v1.0.${i}` })) : [{ name: 'v2.0.0' }] };
    };
    assert.equal((await tagNames('acme/skills')).length, 101);
    assert.equal(calls.length, 2);
    global.fetch = async (url) => url.endsWith('page=1')
      ? { ok: true, json: async () => Array.from({ length: 100 }, () => ({ name: 'v1.0.0' })) }
      : { ok: false, status: 503 };
    await assert.rejects(tagNames('acme/skills'), /GitHub API 503/);
  } finally {
    global.fetch = original;
  }
});

test('CLI invalid arguments exit 2 without a success report', () => {
  const result = spawnSync(process.execPath, [require.resolve('./check-upstream-versions.js'), 'invalid'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Audit incomplete: Usage:/);
});
