const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-test-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const write = (file, body, mode = 0o644) => {
    const target = path.join(repo, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, { mode });
  };
  git('init', '-q');
  write('scripts/validate.sh', fs.readFileSync(path.join(__dirname, 'validate.sh')));
  write('scripts/run-tests.sh', `#!/bin/bash
set -eu
printf 'offline\\n' >> "$TRACE"
for file in staged.txt staged-new.txt unstaged.txt 'untracked file.txt'; do
  if [ -f "$file" ]; then printf '%s=%s\\n' "$file" "$(<"$file")" >> "$TRACE"; fi
done
if [ -e deleted.txt ]; then printf 'deleted=present\\n' >> "$TRACE"; else printf 'deleted=absent\\n' >> "$TRACE"; fi
[ ! -f secret.txt ]
[ "\${FAIL_AT:-}" != offline ] || exit 19
`);
  for (const name of ['test-pi-package.sh', 'test-codex-marketplace.sh']) {
    write('scripts/' + name, `#!/bin/bash
printf 'smoke ${name}\\n' >> "$TRACE"
[ "\${FAIL_AT:-}" != smoke ] || exit 23
`);
  }
  write('bin/node', `#!/bin/bash
printf 'node %s\\n' "$*" >> "$TRACE"
[ "\${FAIL_AT:-}" != "$1" ] || exit 29
if [[ "$1" == scripts/gen-* && "$*" != *--check* && "$*" != *--verify* ]]; then
  printf 'regenerated\\n' > generated.txt
  printf 'regenerated\\n' > unstaged.txt
fi
`, 0o755);
  write('bin/claude', '#!/bin/bash\nprintf "claude\\n" >> "$TRACE"\n', 0o755);
  write('staged.txt', 'original');
  write('unstaged.txt', 'original');
  write('deleted.txt', 'original');
  write('.gitignore', 'secret.txt\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  const trace = path.join(temp, 'trace');
  const state = () => ({
    status: git('status', '--porcelain=v1', '-z'),
    diff: git('diff', '--binary', 'HEAD'),
    index: git('diff', '--cached', '--binary'),
    worktrees: git('worktree', 'list', '--porcelain'),
  });
  const run = (args = ['--isolated'], fail = '') => {
    const result = spawnSync('bash', ['scripts/validate.sh', ...args], {
      cwd: repo, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: path.join(repo, 'bin') + ':' + process.env.PATH,
        TRACE: trace, FAIL_AT: fail, TMPDIR: temp },
    });
    assert.ifError(result.error);
    return { ...result, trace: fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '' };
  };
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return { repo, git, write, state, run };
}

test('isolated validation snapshots dirty and untracked files without changing source or index', (t) => {
  const f = fixture(t);
  f.write('staged.txt', 'staged edit');
  f.git('add', 'staged.txt');
  f.write('staged.txt', 'working edit after staging');
  f.write('staged-new.txt', 'new staged file');
  f.git('add', 'staged-new.txt');
  f.write('unstaged.txt', 'unstaged edit');
  f.write('untracked file.txt', 'new file');
  f.write('secret.txt', 'ignored');
  fs.unlinkSync(path.join(f.repo, 'deleted.txt'));
  const before = f.state();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.trace, /staged.txt=working edit after staging/);
  assert.match(result.trace, /staged-new.txt=new staged file/);
  assert.match(result.trace, /deleted=absent/);
  assert.match(result.trace, /unstaged.txt=unstaged edit/);
  assert.match(result.trace, /untracked file.txt=new file/);
  assert.ok(result.trace.indexOf('offline') < result.trace.indexOf('node scripts/gen-skills-tree.js\n'));
  assert.match(result.trace, /node scripts\/gen-codex.js\n/);
  assert.match(result.trace, /smoke test-codex-marketplace.sh/);
  assert.deepEqual(f.state(), before);
  assert.equal(fs.existsSync(path.join(f.repo, 'generated.txt')), false);
  assert.equal(fs.readFileSync(path.join(f.repo, 'untracked file.txt'), 'utf8'), 'new file');
});

for (const fail of ['offline', 'scripts/gen-codex.js', 'smoke']) {
  test(`isolated validation cleans up and propagates ${fail} failure`, (t) => {
    const f = fixture(t);
    const before = f.state();
    const result = f.run(['--isolated'], fail);
    assert.notEqual(result.status, 0);
    if (fail === 'offline') assert.doesNotMatch(result.trace, /node |smoke /);
    assert.deepEqual(f.state(), before);
  });
}

test('isolated validation rejects untracked nested repositories instead of copying ignored secrets', (t) => {
  const f = fixture(t);
  f.git('init', '-q', 'nested');
  f.write('nested/.gitignore', 'secret.txt\n');
  f.write('nested/secret.txt', 'must not enter validation');
  const before = f.state();
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /untracked directory.*nested/);
  assert.equal(result.trace, '', 'validation must not start after snapshot rejection');
  assert.deepEqual(f.state(), before);
  assert.equal(fs.readFileSync(path.join(f.repo, 'nested/secret.txt'), 'utf8'), 'must not enter validation');
});

test('snapshot creation failure cleans up before any validation executes', (t) => {
  const f = fixture(t);
  f.write('bin/tar', '#!/bin/bash\nexit 31\n', 0o755);
  const before = f.state();
  const result = f.run();
  assert.equal(result.status, 31, result.stderr);
  assert.equal(result.trace, '');
  assert.deepEqual(f.state(), before);
});

test('catalog-only keeps projections untouched and does not run smokes', (t) => {
  const f = fixture(t);
  const before = f.state();
  const result = f.run(['--catalog-only']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.trace, /node scripts\/gen-\S+\.js\n|smoke /);
  assert.deepEqual(f.state(), before);
});

test('unknown or extra validation arguments fail before running checks', (t) => {
  const f = fixture(t);
  for (const args of [['--typo'], ['--catalog-only', '--isolated']]) {
    const result = f.run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.trace, '');
  }
});
