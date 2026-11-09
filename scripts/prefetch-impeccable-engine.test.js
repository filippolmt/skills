const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const asset = `impeccable-${{ linux: 'linux', darwin: 'darwin' }[process.platform]}-${{ x64: 'x64', arm64: 'arm64' }[process.arch]}`;
const engine = '#!/bin/sh\necho impeccable-engine 9.9.9\n';
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

// A checkout with a fake impeccable package, a fake curl serving $PAYLOAD, and a
// launcher stub that answers only from the version-pinned cache.
function fixture(t, payload, manifestAsset = asset) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prefetch-impeccable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, body, mode = 0o644) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body, { mode });
  };
  const pkg = '.agents/plugins/packages/impeccable/skills/impeccable/scripts';
  write('scripts/prefetch-impeccable-engine.sh', fs.readFileSync(path.join(__dirname, 'prefetch-impeccable-engine.sh')));
  write(`${pkg}/VERSION`, '9.9.9\n');
  write(`${pkg}/engine-checksums.txt`, `9.9.9 ${manifestAsset} ${sha(engine)}\n`);
  write(`${pkg}/impeccable`, '#!/bin/sh\nexec "$IMPECCABLE_HOME/bin/9.9.9/impeccable" "$@"\n', 0o755);
  write('bin/curl', `#!/bin/sh
echo curl >> "$TRACE"
while [ "$1" != -o ]; do shift; done
printf '%s' "$PAYLOAD" > "$2"
`, 0o755);
  const cache = path.join(root, 'cache');
  const trace = path.join(root, 'trace');
  const run = () => spawnSync('bash', [path.join(root, 'scripts/prefetch-impeccable-engine.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, IMPECCABLE_HOME: cache, TRACE: trace, PAYLOAD: payload },
  });
  const curls = () => (fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).length : 0);
  return { run, curls, cached: path.join(cache, 'bin/9.9.9/impeccable') };
}

test('downloads the engine into the version-pinned cache and reuses a verified copy', (t) => {
  const f = fixture(t, engine);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(fs.readFileSync(f.cached, 'utf8'), engine);
  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(f.curls(), 1, 'a cached copy matching the manifest is not downloaded again');
});

test('a checksum mismatch fails and leaves nothing in the cache', (t) => {
  const f = fixture(t, 'tampered');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
  assert.deepEqual(fs.readdirSync(path.dirname(f.cached)), []);
});

test('a corrupted cached copy is downloaded again', (t) => {
  const f = fixture(t, engine);
  fs.mkdirSync(path.dirname(f.cached), { recursive: true });
  fs.writeFileSync(f.cached, 'corrupt', { mode: 0o755 });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.curls(), 1);
  assert.equal(fs.readFileSync(f.cached, 'utf8'), engine);
});

test('a missing manifest entry fails before any download', (t) => {
  const f = fixture(t, engine, 'impeccable-other-platform');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no checksum/);
  assert.equal(f.curls(), 0);
});
