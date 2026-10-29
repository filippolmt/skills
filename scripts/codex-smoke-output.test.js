const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { hasWarning } = require('./codex-smoke-warnings.js');

test('warning parser distinguishes diagnostics from data and ordinary messages', () => {
  for (const output of [
    '{"warnings":[],"warning":null,"warn":false}',
    '{"warnings":{},"message":"WARN is an ordinary message"}',
    '{\n  "warnings": []\n}',
    'An ordinary message about warnings',
  ]) assert.equal(hasWarning(output), false, output);
  for (const output of [
    '{"result":{"data":[{"warnings":["diagnostic"]}]}}',
    '{"warning":"diagnostic"}',
    '{"level":"WARN","message":"diagnostic"}',
    'WARN diagnostic', 'Warning: diagnostic',
    '2026-01-01T00:00:00Z WARN codex: diagnostic',
    '{"warnings":[]}\nWARN diagnostic',
  ]) assert.equal(hasWarning(output), true, output);
});

const fakeCodex = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
fs.appendFileSync(process.env.TRACE, home + '\\n');
const output = value => console.log(JSON.stringify(value));
const mode = process.env.MODE;
if (args[0] === 'app-server') {
  if (mode === 'app-warning') console.error('WARN app-server diagnostic');
  if (mode === 'app-stdout-warning') output({ method: 'warning', params: { message: 'app-server diagnostic' } });
  const lines = require('node:readline').createInterface({ input: process.stdin });
  lines.on('line', line => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') output({ id: request.id, result: { codexHome: home, message: 'Warning: ordinary message content' } });
    if (request.method === 'hooks/list') {
      const code = mode === 'hook-warning' ? 'console.error("Warning: hook diagnostic")' :
        mode === 'hook-stdout-warning' ? 'console.log("Warning: hook diagnostic")' :
        mode === 'hook-error' ? 'process.exit(7)' :
        'console.log(JSON.stringify({warnings:[],message:"Warning: ordinary content"})); console.error("ordinary warning content")';
      const command = JSON.stringify(process.execPath) + ' -e ' + JSON.stringify(code);
      output({ id: request.id, result: { data: [{ hooks: ['postToolUse', 'stop'].map(eventName => ({
        eventName, pluginId: 'impeccable@filippo-skills', source: 'plugin', enabled: true,
        trustStatus: 'untrusted', command
      })), cwd: process.cwd(), warnings: mode === 'app-field-warning' ? ['app-server diagnostic'] : [], errors: [] }] } });
      if (mode === 'app-error') process.exit(7);
    }
  });
} else {
  const state = path.join(home, 'installed.json');
  let installed = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state)) : [];
  const stage = args[1] === 'marketplace' ? args[2] : args[1];
  const removalCheck = stage === 'list' && fs.existsSync(path.join(home, 'removed'));
  if (mode === stage + '-warning' || (mode === 'removal-warning' && removalCheck))
    console.error('WARNING: CLI diagnostic');
  if (mode === stage + '-error') { console.error('CLI failed'); process.exit(7); }
  if (stage === 'upgrade') {
    const counter = path.join(home, 'attempts');
    const attempt = fs.existsSync(counter) ? Number(fs.readFileSync(counter)) + 1 : 1;
    fs.writeFileSync(counter, String(attempt));
    fs.appendFileSync(process.env.TRACE, 'upgrade attempt\\n');
    if (mode === 'timeout' || (mode === 'retry' && attempt === 1) || mode === 'timeout-warning') {
      if (mode === 'timeout-warning') console.error('WARN timeout diagnostic');
      console.error('git clone timed out');
      output({ errors: ['git clone timed out'] });
    } else output({ selectedMarketplaces: ['filippo-skills'], upgradedRoots: ['root'], errors: [] });
  } else if (args[1] === 'marketplace') {
    output({ marketplaceName: 'filippo-skills', warnings: mode === 'stdout-array-warning' ? ['CLI diagnostic'] : [], message: 'ordinary warning content', ...(mode === 'stdout-warning' ? { warning: 'CLI diagnostic' } : {}) });
  } else if (stage === 'add') {
    installed.push(args[2]);
    fs.writeFileSync(state, JSON.stringify(installed));
    output({ pluginId: args[2] });
  } else if (stage === 'remove') {
    installed = installed.filter(id => id !== args[2]);
    fs.writeFileSync(state, JSON.stringify(installed));
    fs.writeFileSync(path.join(home, 'removed'), '');
    output({ pluginId: args[2] });
  } else if (args.includes('--available')) {
    output({ available: [{ pluginId: 'tdd@filippo-skills' }] });
  } else output({ installed: installed.map(pluginId => ({ pluginId, installed: true, enabled: true })) });
}
`;

function runSmoke(mode = '') {
  // The checkout is deliberately in OS temp; CODEX_HOME must not follow it there.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-output-'));
  const home = fs.mkdtempSync(path.join(os.homedir(), '.codex-output-test-'));
  function write(file, content, executable = false) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: executable ? 0o755 : 0o644 });
  }
  try {
    assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
    for (const script of ['test-codex-marketplace.sh', 'test-codex-hooks.mjs', 'codex-smoke-warnings.js'])
      write('scripts/' + script, fs.readFileSync(path.join(__dirname, script)));
    if (mode === 'checker-error') write('scripts/codex-smoke-warnings.js', 'throw new Error("warning checker failed");');
    write('.agents/plugins/marketplace.json', JSON.stringify({ plugins: [{ name: 'tdd' }] }));
    write('bin/codex', fakeCodex, true);
    write('bin/sleep', '#!/bin/sh\nexit 0\n', true);
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex', 'sentinel'), 'untouched');
    const trace = path.join(root, 'trace');
    const result = spawnSync('bash', ['scripts/test-codex-marketplace.sh'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'),
        PATH: root + '/bin:' + process.env.PATH, TRACE: trace, MODE: mode },
    });
    assert.ifError(result.error);
    const calls = fs.readFileSync(trace, 'utf8').trim().split('\n');
    for (const codexHome of calls.filter(line => line !== 'upgrade attempt')) {
      assert.ok(codexHome.startsWith(home + path.sep), codexHome);
      assert.notEqual(codexHome, path.join(home, '.codex'));
      assert.ok(!fs.existsSync(codexHome), 'smoke home was not cleaned up');
    }
    assert.deepEqual(fs.readdirSync(home), ['.codex']);
    assert.equal(fs.readFileSync(path.join(home, '.codex', 'sentinel'), 'utf8'), 'untouched');
    return { ...result, attempts: calls.filter(line => line === 'upgrade attempt').length };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('empty warnings in real hooks/list shape and CLI JSON pass with disposable state', () => {
  const result = runSmoke();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Codex marketplace lifecycle passed/);
});

for (const mode of ['add-warning', 'list-warning', 'removal-warning', 'upgrade-warning', 'stdout-warning', 'stdout-array-warning', 'app-field-warning', 'app-warning', 'app-stdout-warning', 'hook-warning', 'hook-stdout-warning']) {
  test(mode + ' fails despite zero CLI exit status and preserves the diagnostic', () => {
    const result = runSmoke(mode);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /diagnostic/);
    assert.match(result.stderr, /warning/i);
  });
}

for (const mode of ['add-error', 'upgrade-error', 'hook-error', 'app-error', 'checker-error']) {
  test(mode + ' still fails', () => {
    assert.notEqual(runSmoke(mode).status, 0);
  });
}

test('clone timeout retries and can recover', () => {
  const result = runSmoke('retry');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.attempts, 2);
  assert.match(result.stderr, /timed out cloning, retrying/);
});

test('clone timeout fails after three attempts', () => {
  const result = runSmoke('timeout');
  assert.notEqual(result.status, 0);
  assert.equal(result.attempts, 3);
  assert.match(result.stderr, /marketplace upgrade failed \(attempt 3\/3\)/);
});

test('a clone timeout with a warning is not retried', () => {
  const result = runSmoke('timeout-warning');
  assert.notEqual(result.status, 0);
  assert.equal(result.attempts, 1);
  assert.match(result.stderr, /WARN timeout diagnostic/);
});
