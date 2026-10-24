const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/regenerate.yml'), 'utf8');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'regenerate-rebase-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const main = path.join(root, 'main');
  const checkout = path.join(root, 'checkout');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  git(root, 'clone', remote, main);
  function identity(cwd) {
    git(cwd, 'config', 'user.name', 'Test');
    git(cwd, 'config', 'user.email', 'test@example.com');
  }
  identity(main);
  function save(cwd, file, text) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
  }
  function commit(cwd, file, text) {
    save(cwd, file, text);
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-m', file);
    return git(cwd, 'rev-parse', 'HEAD');
  }
  commit(main, 'skills/example/SKILL.md', 'old projection\n');
  git(main, 'push', 'origin', 'main');
  git(root, 'clone', '--depth=1', `file://${remote}`, checkout);
  identity(checkout);
  save(checkout, 'skills/example/SKILL.md', 'new projection\n');
  const output = path.join(root, 'output');
  return { main, checkout, git, commit, output, run() {
    const match = workflow.match(/      - name: Prepare regeneration for publication\n[\s\S]*?        run: \|\n([\s\S]*?)        shell: bash/);
    assert.ok(match, 'workflow must prepare the generated commit before publication');
    const script = match[1].replace(/^          /gm, '');
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: checkout, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
    });
  } };
}

test('a shallow checkout preserves a newer workflow and publishes only the generated delta', (t) => {
  const f = fixture(t);
  f.commit(f.main, '.github/workflows/whole-sources.yml', 'new workflow\n');
  f.git(f.main, 'push', 'origin', 'main');
  assert.equal(f.git(f.checkout, 'rev-parse', '--is-shallow-repository'), 'true');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(f.checkout, '.github/workflows/whole-sources.yml'), 'utf8'), 'new workflow\n');
  assert.equal(f.git(f.checkout, 'diff', '--name-only', 'origin/main', 'HEAD'), 'skills/example/SKILL.md');
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD^'), f.git(f.main, 'rev-parse', 'HEAD'));
  assert.match(fs.readFileSync(f.output, 'utf8'), /changed=true/);
});

test('a conflicting projection stops publication and leaves no rebase in progress', (t) => {
  const f = fixture(t);
  f.commit(f.main, 'skills/example/SKILL.md', 'conflicting projection\n');
  f.git(f.main, 'push', 'origin', 'main');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rebase conflict/);
  assert.ok(!fs.existsSync(f.output));
  assert.equal(f.git(f.checkout, 'status', '--porcelain'), '');
  assert.equal(f.git(f.checkout, 'show', 'HEAD:skills/example/SKILL.md'), 'new projection');
});

for (const file of [null, 'docs/adr/example.md']) {
  test(`publishes when main ${file ? 'changes only documentation' : 'has not advanced'}`, (t) => {
    const f = fixture(t);
    if (file) {
      f.commit(f.main, file, 'documentation\n');
      f.git(f.main, 'push', 'origin', 'main');
    }
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(fs.readFileSync(f.output, 'utf8'), /changed=true/);
    assert.equal(f.git(f.checkout, 'diff', '--name-only', 'origin/main', 'HEAD'), 'skills/example/SKILL.md');
  });
}

test('every main push can replace a stale run and publication uses the prepared commit', () => {
  const trigger = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(trigger, /branches: \[main\]/);
  assert.doesNotMatch(trigger, /paths(?:-ignore)?:/);
  const publication = workflow.slice(workflow.indexOf('      - name: Open or update the regeneration PR'));
  assert.match(publication, /if: steps\.publication\.outputs\.changed == 'true'/);
  assert.ok(publication.indexOf('git push') < publication.indexOf('sha="$(git rev-parse HEAD)"'));
});

test('an already-applied generation skips publication instead of describing the main commit as regeneration', (t) => {
  const f = fixture(t);
  f.commit(f.main, 'skills/example/SKILL.md', 'new projection\n');
  f.git(f.main, 'push', 'origin', 'main');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.git(f.checkout, 'rev-parse', 'HEAD'), f.git(f.main, 'rev-parse', 'HEAD'));
  assert.match(fs.readFileSync(f.output, 'utf8'), /changed=false/);
});

test('an already-applied generation still rejects a subsequent catalog change', (t) => {
  const f = fixture(t);
  f.commit(f.main, 'skills/example/SKILL.md', 'new projection\n');
  f.commit(f.main, '.claude-plugin/marketplace.json', 'changed catalog\n');
  f.git(f.main, 'push', 'origin', 'main');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generation inputs changed/);
  assert.match(result.stderr, /\.claude-plugin\/marketplace\.json/);
  assert.ok(!fs.existsSync(f.output), 'must not report a successful no-op');
});

for (const file of [
  '.claude-plugin/marketplace.json', 'scripts/catalog.js', 'scripts/gen-readme.js',
  'scripts/catalog-meta.json', 'README.md', 'LICENSE', 'plugins/example/plugin.json',
  'overlays/example.patch', 'skills/other/SKILL.md', '.agents/plugins/example/plugin.json',
  'docs/distribution-parity.md', 'docs/pi-package-filters.md', 'unknown-input',
]) {
  test(`refuses a cleanly applying rebase over changed input ${file}`, (t) => {
    const f = fixture(t);
    f.commit(f.main, file, 'changed input\n');
    f.git(f.main, 'push', 'origin', 'main');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /generation inputs changed/);
    assert.match(result.stderr, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(!fs.existsSync(f.output), 'must not enable publication');
  });
}
