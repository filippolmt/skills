// Self-check for gen-skills-tree.js. Run: node scripts/gen-skills-tree.test.js
// Exercises the pure surface only — parseFrontmatter, vendorList, renderSource,
// treeFingerprint. build() clones 17 repositories, so it belongs to CI's
// `--check` run, not to a test that has to pass offline.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFrontmatter, renderSource, vendorList, treeFingerprint } = require('./gen-skills-tree.js');

const gitsub = (name, p) => ({
  name,
  source: { source: 'git-subdir', url: 'https://github.com/acme/skills', path: p, sha: 'deadbeef' },
});
const PLUGINS = [
  { name: 'mode-router', source: './plugins/mode-router' },
  gitsub('tdd', 'skills/tdd'),
  gitsub('grilling', 'skills/grilling'),
  gitsub('other', 'skills/other'),
];

test('parseFrontmatter reads name and description, quoted or bare', () => {
  assert.deepEqual(parseFrontmatter('---\nname: tdd\ndescription: "Test first."\n---\n# Body'), {
    name: 'tdd',
    description: 'Test first.',
  });
});

test('parseFrontmatter survives a folded description without inventing one', () => {
  // `description: >` continues on the following lines. We only need `name`, and
  // a wrong one-line description would be worse than none.
  const { name, description } = parseFrontmatter('---\nname: glab\ndescription: >\n  GitLab CLI.\n---\n');
  assert.equal(name, 'glab');
  assert.equal(description, undefined);
});

test('parseFrontmatter returns nothing when there is no frontmatter', () => {
  assert.deepEqual(parseFrontmatter('# Just a heading\n'), {});
});

test('vendorList takes every git-subdir entry, never a local plugin', () => {
  assert.deepEqual(vendorList(PLUGINS).map((e) => e.name), ['tdd', 'grilling', 'other']);
});

test('renderSource records the commit, the licence and the entry it came from', () => {
  const md = renderSource({
    entry: 'tdd',
    repo: 'acme/skills',
    sha: 'abc123',
    dir: 'skills/tdd',
    licence: 'LICENSE',
  });
  assert.match(md, /do not edit/);
  assert.match(md, /https:\/\/github\.com\/acme\/skills\/tree\/abc123\/skills\/tdd/);
  assert.match(md, /\*\*Commit\*\*: `abc123`/);
  assert.match(md, /`LICENSE`/);
  assert.doesNotMatch(md, /Overlay applied/);
});

test('renderSource names the overlay when one was applied', () => {
  const md = renderSource({ entry: 'tdd', repo: 'a/b', sha: 'x', dir: '.', licence: 'LICENSE', overlay: 'tdd.patch' });
  assert.match(md, /\*\*Overlay applied\*\*: `overlays\/tdd\.patch`/);
});

test('treeFingerprint is empty for a missing tree and stable for the same content', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-b-'));
  try {
    assert.equal(treeFingerprint(path.join(a, 'nope')), '');
    for (const d of [a, b]) {
      fs.mkdirSync(path.join(d, 'tdd'));
      fs.writeFileSync(path.join(d, 'tdd', 'SKILL.md'), 'same');
    }
    assert.equal(treeFingerprint(a), treeFingerprint(b));
    fs.writeFileSync(path.join(b, 'tdd', 'SKILL.md'), 'different');
    assert.notEqual(treeFingerprint(a), treeFingerprint(b));
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('treeFingerprint sees a file added, not only a file changed', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-c-'));
  try {
    fs.writeFileSync(path.join(d, 'SKILL.md'), 'x');
    const before = treeFingerprint(d);
    fs.writeFileSync(path.join(d, 'SOURCE.md'), 'y');
    assert.notEqual(before, treeFingerprint(d));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
