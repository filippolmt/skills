// Self-check for gen-skills-tree.js. Run: node scripts/gen-skills-tree.test.js
// Exercises the pure surface — parseFrontmatter, vendorList, renderSource,
// treeFingerprint — plus build()'s three loud failures, which are the whole point of
// the generator and so must not be left to CI. build() takes its checkout as a
// dependency, so those run against fake repositories on disk, with no network.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFrontmatter, renderSource, vendorList, treeFingerprint, build } = require('./gen-skills-tree.js');

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

// --- build(), against fake repositories -------------------------------------
//
// The three throws below are the generator's reason to exist: each one is a way a
// skill could go missing in silence. A fake checkout is enough to exercise them.

function fakeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-repo-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

const skill = (name) => `---\nname: ${name}\ndescription: Does ${name}.\n---\n# ${name}\n`;
const entry = (name, p) => ({
  name,
  source: { source: 'git-subdir', url: 'https://github.com/acme/skills', path: p, sha: 'abc123def456' },
});

function withBuild(files, plugins, fn) {
  const repo = fakeRepo(files);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-tree-'));
  try {
    return fn({ dest, plugins, deps: { checkout: () => repo } });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
}

test('build throws, naming the entry, when a path does not resolve at its sha', () => {
  withBuild(
    { LICENSE: 'MIT', 'skills/tdd/SKILL.md': skill('tdd') },
    [entry('tdd', 'skills/tdd'), entry('gone', 'skills/renamed-away')],
    ({ dest, plugins, deps }) => {
      assert.throws(() => build(dest, plugins, deps), /will not resolve[\s\S]*gone/);
    }
  );
});

test('build throws when the upstream ships no licence', () => {
  withBuild({ 'skills/tdd/SKILL.md': skill('tdd') }, [entry('tdd', 'skills/tdd')], ({ dest, plugins, deps }) => {
    assert.throws(() => build(dest, plugins, deps), /no licence, no right to redistribute/);
  });
});

test('build throws when two entries resolve to one skill name', () => {
  withBuild(
    { LICENSE: 'MIT', 'a/SKILL.md': skill('tdd'), 'b/SKILL.md': skill('tdd') },
    [entry('one', 'a'), entry('two', 'b')],
    ({ dest, plugins, deps }) => {
      assert.throws(() => build(dest, plugins, deps), /skill name 'tdd' comes from both/);
    }
  );
});

test('build throws when a SKILL.md has no frontmatter name', () => {
  withBuild({ LICENSE: 'MIT', 'skills/x/SKILL.md': '# No frontmatter\n' }, [entry('x', 'skills/x')], ({ dest, plugins, deps }) => {
    assert.throws(() => build(dest, plugins, deps), /has no frontmatter name/);
  });
});

test('build writes the copy, the licence and SOURCE.md, and skips local plugins', () => {
  withBuild(
    { LICENSE: 'MIT text', 'skills/tdd/SKILL.md': skill('tdd'), 'skills/tdd/tests.md': 'more' },
    [{ name: 'mode-router', source: './plugins/mode-router' }, entry('tdd', 'skills/tdd')],
    ({ dest, plugins, deps }) => {
      assert.deepEqual(build(dest, plugins, deps), ['tdd']);
      assert.deepEqual(fs.readdirSync(dest), ['tdd']);
      assert.equal(fs.readFileSync(path.join(dest, 'tdd', 'LICENSE'), 'utf8'), 'MIT text');
      assert.ok(fs.existsSync(path.join(dest, 'tdd', 'tests.md')));
      const source = fs.readFileSync(path.join(dest, 'tdd', 'SOURCE.md'), 'utf8');
      assert.match(source, /\*\*Commit\*\*: `abc123def456`/);
      assert.match(source, /skills\/tdd/);
    }
  );
});

test("build keeps a skill's own licence rather than overwriting it", () => {
  withBuild(
    { LICENSE: 'repo-root licence', 'skills/tdd/SKILL.md': skill('tdd'), 'skills/tdd/LICENSE': 'the skill/s own licence' },
    [entry('tdd', 'skills/tdd')],
    ({ dest, plugins, deps }) => {
      build(dest, plugins, deps);
      assert.equal(fs.readFileSync(path.join(dest, 'tdd', 'LICENSE'), 'utf8'), 'the skill/s own licence');
    }
  );
});

test('build with a null dest resolves every path and copies nothing', () => {
  withBuild(
    { LICENSE: 'MIT', 'skills/tdd/SKILL.md': skill('tdd') },
    [entry('tdd', 'skills/tdd')],
    ({ dest, plugins, deps }) => {
      assert.deepEqual(build(null, plugins, deps), []);
      assert.deepEqual(fs.readdirSync(dest), []);
    }
  );
});
