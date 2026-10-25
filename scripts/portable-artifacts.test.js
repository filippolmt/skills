const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, buildFromInventory } = require('./gen-skills-tree.js');
const { writeCodexDistribution } = require('./gen-codex.js');
const { copyAttribution, writeConvertedSkill } = require('./portable-artifacts.js');

function fixture(t, { kind = 'skill', name = 'audit-example', licence = true, adapted = false } = {}) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-audit-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const repo = path.join(sandbox, 'repo');
  const source = path.join(repo, 'plugin');
  const file = kind === 'skill' ? 'skills/example/SKILL.md' : `${kind}s/review.md`;
  fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
  fs.writeFileSync(path.join(source, file), `---\nname: ${name}\ndescription: Example.\n---\n# Example\n`);
  if (licence) fs.writeFileSync(path.join(repo, 'LICENSE'), 'MIT root licence\n');
  fs.writeFileSync(path.join(repo, 'NOTICE.md'), 'Derived from ehmo/platform-design-skills.\n');
  fs.writeFileSync(path.join(repo, 'THIRD_PARTY_LICENSES.txt'), 'Third-party MIT attribution.\n');
  const plugin = { name: 'audit-plugin', source: { source: 'git-subdir', url: 'https://github.com/example/audit', path: 'plugin', sha: 'abcdef1234567890' } };
  const artifact = { kind, path: file, dispositions: { pi: { disposition: 'native' }, codex: { disposition: kind === 'skill' && !adapted ? 'native' : 'adapted' } } };
  if (adapted) artifact.dispositions.codex.sourcePath = `plugin/${file}`;
  const inventory = { name: plugin.name, repoRoot: repo, sourceRoot: source, runtimeDependencies: [], artifacts: [artifact] };
  const out = path.join(sandbox, 'out');
  return { sandbox, repo, source, file, plugin, artifact, inventory, out };
}

for (const target of ['pi', 'legacy', 'codex', 'codex-adapted']) {
  test(`${target} preserves root licence, NOTICE and third-party attribution`, (t) => {
    const f = fixture(t, { adapted: target === 'codex-adapted' });
    fs.writeFileSync(path.join(f.source, 'skills/example/SOURCE.md'), 'Existing provenance.\n');
    let destination;
    if (target.startsWith('codex')) {
      writeCodexDistribution([f.plugin], [f.inventory], f.out);
      destination = path.join(f.out, 'packages', f.plugin.name, 'skills', 'audit-example');
    } else {
      fs.mkdirSync(f.out);
      if (target === 'pi') buildFromInventory(f.out, [f.plugin], [f.inventory]);
      else build(f.out, [f.plugin], { checkout: () => f.repo });
      destination = path.join(f.out, 'audit-example');
    }
    for (const name of ['LICENSE', 'NOTICE.md', 'THIRD_PARTY_LICENSES.txt']) {
      assert.equal(fs.readFileSync(path.join(destination, name), 'utf8'), fs.readFileSync(path.join(f.repo, name), 'utf8'));
    }
  });
}

for (const kind of ['command', 'agent']) {
  for (const target of ['pi', 'codex', 'direct']) {
    test(`${target} refuses unlicensed external ${kind} conversions before creating a skill`, (t) => {
      const f = fixture(t, { kind, licence: false });
      const run = target === 'pi' ? () => buildFromInventory(f.out, [f.plugin], [f.inventory])
        : target === 'codex' ? () => writeCodexDistribution([f.plugin], [f.inventory], f.out)
          : () => writeConvertedSkill(f.inventory, f.plugin, f.artifact, f.out);
      assert.throws(run, /no licence, no right to redistribute/);
      assert.equal(fs.existsSync(path.join(f.out, 'SKILL.md')), false);
      assert.equal(fs.existsSync(path.join(f.out, 'audit-plugin-review', 'SKILL.md')), false);
      assert.equal(fs.existsSync(path.join(f.out, 'packages', f.plugin.name, 'skills')), false);
    });
  }
  test(`pi and Codex retain notices for converted ${kind}s`, (t) => {
    const f = fixture(t, { kind });
    const pi = path.join(f.sandbox, 'pi');
    buildFromInventory(pi, [f.plugin], [f.inventory]);
    writeCodexDistribution([f.plugin], [f.inventory], f.out);
    for (const destination of [path.join(pi, 'audit-plugin-review'), path.join(f.out, 'packages', f.plugin.name, 'skills', 'audit-plugin-review')]) {
      assert.equal(fs.readFileSync(path.join(destination, 'NOTICE.md'), 'utf8'), 'Derived from ehmo/platform-design-skills.\n');
    }
  });
}

for (const name of ['../escaped', 'nested/name', 'nested\\name', '.', 'Wrong_Name', 'a'.repeat(65)]) {
  test(`Codex rejects native name ${name} before deleting or writing destinations`, (t) => {
    const f = fixture(t, { name });
    fs.mkdirSync(path.join(f.out, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(f.out, 'packages', 'sentinel'), 'untouched');
    assert.throws(() => writeCodexDistribution([f.plugin], [f.inventory], f.out), /invalid skill name/);
    assert.equal(fs.readFileSync(path.join(f.out, 'packages', 'sentinel'), 'utf8'), 'untouched');
    assert.deepEqual(fs.readdirSync(path.join(f.out, 'packages')), ['sentinel']);
  });
}

test('Codex rejects converted names before deleting or writing destinations', (t) => {
  const f = fixture(t, { kind: 'command' });
  f.artifact.path = 'commands/Wrong_Name.md';
  fs.renameSync(path.join(f.source, 'commands/review.md'), path.join(f.source, f.artifact.path));
  fs.mkdirSync(path.join(f.out, 'packages'), { recursive: true });
  fs.writeFileSync(path.join(f.out, 'packages', 'sentinel'), 'untouched');
  assert.throws(() => writeCodexDistribution([f.plugin], [f.inventory], f.out), /invalid skill name/);
  assert.equal(fs.readFileSync(path.join(f.out, 'packages', 'sentinel'), 'utf8'), 'untouched');
});

test('direct conversions reject unsafe names before destination writes', (t) => {
  const f = fixture(t, { kind: 'command' });
  f.inventory.name = '../escape';
  assert.throws(() => writeConvertedSkill(f.inventory, f.plugin, f.artifact, f.out), /invalid skill name/);
  assert.equal(fs.existsSync(f.out), false);
});

for (const link of ['NOTICE.md', 'LICENSE', 'upstream-attribution']) {
  test(`attribution refuses a symlink at ${link} without writing outside staging`, (t) => {
    const f = fixture(t);
    const outside = path.join(f.sandbox, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(f.out);
    if (link === 'upstream-attribution') fs.writeFileSync(path.join(f.out, 'NOTICE.md'), 'Skill-specific notice.');
    fs.symlinkSync(link === 'upstream-attribution' ? outside : path.join(outside, 'escaped'), path.join(f.out, link));
    assert.throws(() => copyAttribution(f.repo, f.out), /symlink/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
}

for (const file of ['NOTICE.md', 'SOURCE.md']) {
  for (const builder of ['active', 'legacy']) {
    test(`${builder} refuses native ${file} symlinks before writing outside staging`, (t) => {
      const f = fixture(t);
      fs.symlinkSync('../../escaped', path.join(f.source, 'skills/example', file));
      fs.mkdirSync(f.out);
      assert.throws(() => builder === 'active'
        ? buildFromInventory(f.out, [f.plugin], [f.inventory])
        : build(f.out, [f.plugin], { checkout: () => f.repo }), /symlink/);
      assert.equal(fs.existsSync(path.join(f.sandbox, 'escaped')), false);
    });
  }
}

test('root notices do not overwrite a skill-specific notice', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.source, 'skills/example/NOTICE.md'), 'Skill-specific notice.\n');
  buildFromInventory(f.out, [f.plugin], [f.inventory]);
  const destination = path.join(f.out, 'audit-example');
  assert.equal(fs.readFileSync(path.join(destination, 'NOTICE.md'), 'utf8'), 'Skill-specific notice.\n');
  assert.equal(fs.readFileSync(path.join(destination, 'upstream-attribution', 'NOTICE.md'), 'utf8'), 'Derived from ehmo/platform-design-skills.\n');
});
