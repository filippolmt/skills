const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

// Run unmodified CLIs in a tiny repository; Git can use only the local fixture.
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-removal-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'marketplace');
  const upstream = path.join(temp, 'upstream');
  const cache = path.join(temp, 'tmp');
  for (const dir of [root, upstream, cache]) fs.mkdirSync(dir, { recursive: true });
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  for (const name of fs.readdirSync(__dirname).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))) {
    write(`scripts/${name}`, fs.readFileSync(path.join(__dirname, name), 'utf8'));
  }
  const env = {
    ...process.env, TMPDIR: cache, TMP: cache, TEMP: cache,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(temp, 'gitconfig'),
    GIT_CONFIG_COUNT: '0', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
  };
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, `[url "file://${upstream}"]\n\tinsteadOf = https://github.com/fixture/removal\n`);
  const git = (...args) => execFileSync('git', args, { cwd: upstream, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(upstream, 'LICENSE'), 'MIT License\nCopyright Fixture\n');
  for (const name of ['one', 'gone']) {
    fs.mkdirSync(path.join(upstream, name));
    fs.writeFileSync(path.join(upstream, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Fixture skill.\n---\n\n# ${name}\n`);
  }
  git('add', '.');
  git('commit', '-qm', 'initial skills');
  const sha = git('rev-parse', 'HEAD');
  write('.claude-plugin/marketplace.json', {
    name: 'fixture', owner: { name: 'Fixture' }, plugins: [
      ...['one', 'gone'].map((name) => ({ name, description: 'Fixture skill.', source: { source: 'git-subdir', url: 'https://github.com/fixture/removal', path: name, sha } })),
      { name: 'one-bundle', source: './plugins/one-bundle', description: 'Fixture bundle.' },
    ],
  });
  write('plugins/one-bundle/.claude-plugin/plugin.json', { name: 'one-bundle', version: '0.1.0', description: 'Fixture bundle.', dependencies: ['one', 'gone'] });
  write('scripts/catalog-meta.json', { groups: [{ repo: 'fixture/removal', tagline: 'Fixture', kind: 'skill' }] });
  write('scripts/distribution-meta.json', {
    runtimeDependencies: { gone: [] },
    artifacts: { 'gone/skill:SKILL.md': { codex: { disposition: 'native' }, pi: { disposition: 'native' } } },
    presentationOverrides: { gone: { displayName: 'Gone' } },
    unsupportedEntries: { gone: {
      codex: { disposition: 'unsupported', limitation: 'Fixture.', fallback: 'Fixture.' },
      pi: { disposition: 'unsupported', limitation: 'Fixture.', fallback: 'Fixture.' },
    } },
  });
  write('README.md', '<!-- catalog:start -->\n<!-- catalog:end -->\n<!-- bundles:start -->\n<!-- bundles:end -->\n');
  fs.mkdirSync(path.join(root, 'docs'));
  const cli = (script, ...args) => {
    const result = spawnSync(process.execPath, [`scripts/${script}.js`, ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  };
  const succeeds = (script, ...args) => {
    const result = cli(script, ...args);
    assert.equal(result.status, 0, `${script} ${args.join(' ')}\n${result.output}`);
    return result.output;
  };
  const generate = () => {
    for (const script of ['gen-skills-tree', 'gen-readme', 'gen-distribution', 'gen-pi', 'gen-codex']) succeeds(script);
  };
  const check = () => {
    for (const script of ['gen-skills-tree', 'gen-readme', 'gen-distribution', 'gen-pi', 'gen-codex']) succeeds(script, '--check');
  };
  const removeUpstream = () => {
    fs.rmSync(path.join(upstream, 'gone'), { recursive: true });
    git('add', '-A');
    git('commit', '-qm', 'remove gone');
    const catalog = read('.claude-plugin/marketplace.json');
    for (const plugin of catalog.plugins.filter((plugin) => typeof plugin.source === 'object')) plugin.source.sha = git('rev-parse', 'HEAD');
    write('.claude-plugin/marketplace.json', catalog);
  };
  generate();
  check();
  return { root, read, write, cli, succeeds, generate, check, removeUpstream };
}

function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else files[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  walk(root);
  return files;
}

test('offline CLI sequence prunes upstream removal and its metadata, then all projections pass check', (t) => {
  const f = fixture(t);
  f.removeUpstream();
  const before = snapshot(f.root);
  assert.match(f.succeeds('gen-skills-tree', '--verify-paths'), /gone/);
  f.succeeds('gen-distribution', '--verify');
  assert.deepEqual(snapshot(f.root), before, 'verification must not write');
  assert.notEqual(f.cli('gen-skills-tree', '--check').status, 0);
  assert.deepEqual(snapshot(f.root), before, 'check must not write');
  f.generate();
  assert.deepEqual(f.read('.claude-plugin/marketplace.json').plugins.map((entry) => entry.name), ['one', 'one-bundle']);
  assert.deepEqual(f.read('scripts/distribution-meta.json'), { runtimeDependencies: {}, artifacts: {}, presentationOverrides: {}, unsupportedEntries: {} });
  const bundle = f.read('plugins/one-bundle/.claude-plugin/plugin.json');
  assert.equal(bundle.version, '0.2.0');
  assert.deepEqual(bundle.dependencies, ['one']);
  assert.equal(fs.existsSync(path.join(f.root, 'skills/gone')), false);
  assert.equal(fs.existsSync(path.join(f.root, '.agents/plugins/packages/gone')), false);
  f.check();
  const generated = snapshot(f.root);
  f.generate();
  assert.deepEqual(snapshot(f.root), generated, 'second generation must be idempotent');
});

test('offline CLI sequence accepts stale packages after a deliberate catalog removal until regeneration', (t) => {
  const f = fixture(t);
  const catalog = f.read('.claude-plugin/marketplace.json');
  catalog.plugins = catalog.plugins.filter((entry) => entry.name !== 'gone');
  f.write('.claude-plugin/marketplace.json', catalog);
  f.write('scripts/distribution-meta.json', {});
  const bundle = f.read('plugins/one-bundle/.claude-plugin/plugin.json');
  bundle.dependencies = ['one'];
  bundle.version = '0.2.0';
  f.write('plugins/one-bundle/.claude-plugin/plugin.json', bundle);
  const before = snapshot(f.root);
  f.succeeds('gen-skills-tree', '--verify-paths');
  f.succeeds('gen-distribution', '--verify');
  assert.deepEqual(snapshot(f.root), before);
  // Keep parity current so only the orphaned package can make --check fail.
  f.succeeds('gen-distribution');
  const beforeCheck = snapshot(f.root);
  const rejected = f.cli('gen-distribution', '--check');
  assert.notEqual(rejected.status, 0, rejected.output);
  assert.match(rejected.output, /generated package has no catalog entry: gone/);
  assert.deepEqual(snapshot(f.root), beforeCheck, 'check must not write');
  f.generate();
  f.check();
  assert.equal(fs.existsSync(path.join(f.root, '.agents/plugins/packages/gone')), false);
});

for (const unsafe of ['incoming runtime dependency', 'non-bundle dependency', 'bundle namesake', 'orphaned surviving metadata']) {
  test(`offline pruning refuses ${unsafe} without changing any file`, (t) => {
    const f = fixture(t);
    if (unsafe === 'incoming runtime dependency') {
      const metadata = f.read('scripts/distribution-meta.json');
      metadata.runtimeDependencies.one = ['gone'];
      f.write('scripts/distribution-meta.json', metadata);
    } else if (unsafe === 'orphaned surviving metadata') {
      const metadata = f.read('scripts/distribution-meta.json');
      metadata.presentationOverrides.typo = { displayName: 'Unknown' };
      f.write('scripts/distribution-meta.json', metadata);
    } else {
      const bundle = f.read('plugins/one-bundle/.claude-plugin/plugin.json');
      if (unsafe === 'non-bundle dependency') {
        f.write('plugins/one-bundle/skills/local/SKILL.md', '---\nname: local\ndescription: Local.\n---\n# Local\n');
      } else {
        const catalog = f.read('.claude-plugin/marketplace.json');
        catalog.plugins.find((entry) => entry.name === 'one-bundle').name = 'gone-bundle';
        f.write('.claude-plugin/marketplace.json', catalog);
        bundle.name = 'gone-bundle';
      }
      f.write('plugins/one-bundle/.claude-plugin/plugin.json', bundle);
    }
    f.removeUpstream();
    const before = snapshot(f.root);
    const result = f.cli('gen-skills-tree');
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /cannot prune|not a bundle|the skill it bundles for|orphaned presentation override/);
    assert.deepEqual(snapshot(f.root), before, result.output);
  });
}
