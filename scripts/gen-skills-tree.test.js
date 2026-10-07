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
const {
  parseFrontmatter,
  renderSource,
  vendorList,
  treeFingerprint,
  breakingBump,
  pruneManifest,
  formatLike,
  unresolved,
  build,
  buildFromInventory,
} = require('./gen-skills-tree.js');

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

// --- pruning ------------------------------------------------------------------

test('a breaking bump is a minor below 1.0.0 and a major above', () => {
  assert.equal(breakingBump('0.1.3'), '0.2.0');
  assert.equal(breakingBump('1.4.2'), '2.0.0');
});

test('pruneManifest drops a helper from a bundle and bumps its version', () => {
  const m = { name: 'triage-bundle', version: '0.1.0', dependencies: ['triage', 'grilling', 'domain-modeling'] };
  assert.deepEqual(pruneManifest(m, ['grilling'], true), { ...m, version: '0.2.0', dependencies: ['triage', 'domain-modeling'] });
});

test('pruneManifest leaves a manifest that names none of the pruned alone', () => {
  assert.equal(pruneManifest({ name: 'x-bundle', version: '0.1.0', dependencies: ['x'] }, ['grilling'], true), null);
  assert.equal(pruneManifest({ name: 'guard', version: '0.1.0' }, ['grilling'], false), null);
});

test('pruneManifest refuses what a script should not settle', () => {
  // mode-router is not a bundle: its hook routes to the modes it depends on.
  assert.throws(() => pruneManifest({ name: 'mode-router', version: '0.9.0', dependencies: ['caveman', 'ponytail'] }, ['caveman'], false), /not a bundle/);
  // A bundle losing the skill it is named after.
  assert.throws(() => pruneManifest({ name: 'triage-bundle', version: '0.1.0', dependencies: ['triage', 'grilling'] }, ['triage'], true), /the skill it bundles for/);
});

test('formatLike keeps a one-line array on one line and a multi-line one multi-line', () => {
  const one = '{\n  "name": "a",\n  "dependencies": ["x", "y", "z"]\n}\n';
  assert.equal(formatLike(one, { name: 'a', dependencies: ['x', 'z'] }), '{\n  "name": "a",\n  "dependencies": ["x", "z"]\n}\n');
  const multi = JSON.stringify({ name: 'a', dependencies: ['x', 'y'] }, null, 2) + '\n';
  assert.equal(formatLike(multi, { name: 'a', dependencies: ['x'] }), JSON.stringify({ name: 'a', dependencies: ['x'] }, null, 2) + '\n');
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
  const overlays = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-overlays-'));
  try {
    return fn({ dest, plugins, deps: { checkout: () => repo, overlays } });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.rmSync(overlays, { recursive: true, force: true });
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

test('unresolved names exactly the entries whose path is gone at their sha', () => {
  withBuild(
    { LICENSE: 'MIT', 'skills/tdd/SKILL.md': skill('tdd') },
    [{ name: 'mode-router', source: './plugins/mode-router' }, entry('tdd', 'skills/tdd'), entry('gone', 'skills/renamed-away')],
    ({ plugins, deps }) => {
      assert.deepEqual(unresolved(plugins, deps), ['gone']);
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

test('shared inventory projects upstream, local, and converted skills together', () => {
  const repo = fakeRepo({
    LICENSE: 'MIT',
    'external/skills/core/SKILL.md': skill('core'),
    'external/agents/reviewer.md': '---\nname: reviewer\ndescription: Review.\n---\n# Review\n',
    'local/skills/local/SKILL.md': skill('local'),
  });
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-tree-'));
  const plugins = [entry('external', 'external'), { name: 'local', source: './plugins/local' }];
  const inventory = [
    {
      name: 'external', sourceRoot: path.join(repo, 'external'), repoRoot: repo, runtimeDependencies: [],
      artifacts: [
        { kind: 'skill', path: 'skills/core/SKILL.md' },
        { kind: 'agent', path: 'agents/reviewer.md' },
      ],
    },
    {
      name: 'local', sourceRoot: path.join(repo, 'local'), repoRoot: repo, runtimeDependencies: [],
      artifacts: [{ kind: 'skill', path: 'skills/local/SKILL.md' }],
    },
  ];
  try {
    assert.deepEqual(buildFromInventory(dest, plugins, inventory), ['core', 'external-reviewer', 'local']);
    for (const name of ['core', 'external-reviewer', 'local']) assert.ok(fs.existsSync(path.join(dest, name, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(dest, 'external-reviewer', 'SOURCE.md')));
    assert.ok(fs.existsSync(path.join(dest, 'local', 'SOURCE.md')));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
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
