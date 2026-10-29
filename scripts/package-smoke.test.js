const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const mockCli = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const names = ['tdd', 'code-review', 'domain-modeling', 'new-upstream-skill'];
const output = value => console.log(JSON.stringify(value));
if (path.basename(process.argv[1]) === 'pi') {
  if (args[0] === 'install') process.exit(0);
  const settings = path.join(process.env.PI_CODING_AGENT_DIR, 'settings.json');
  const filtered = fs.existsSync(settings);
  const commands = names.filter(name => !(filtered && name === 'new-upstream-skill') && name !== process.env.MISSING_SKILL)
    .map(name => ({ name: 'skill:' + name, source: 'skill', sourceInfo: { origin: 'package' } }));
  output({ id: 'commands', success: true, data: { commands } });
} else {
  const home = process.env.CODEX_HOME;
  fs.mkdirSync(home, { recursive: true });
  const state = path.join(home, 'installed.json');
  let installed = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state)) : [];
  if (args[1] === 'marketplace') {
    output(args[2] === 'add' ? { marketplaceName: 'filippo-skills' } :
      { selectedMarketplaces: ['filippo-skills'], upgradedRoots: ['root'], errors: [] });
  } else if (args[1] === 'add') {
    installed.push(args[2]);
    fs.writeFileSync(state, JSON.stringify(installed));
    output({ pluginId: args[2] });
  } else if (args[1] === 'remove') {
    installed = installed.filter(id => id !== args[2]);
    fs.writeFileSync(state, JSON.stringify(installed));
    output({ pluginId: args[2] });
  } else if (args.includes('--available')) {
    output({ available: names.filter(name => name !== process.env.MISSING_PLUGIN).map(name => ({ pluginId: name + '@filippo-skills' })) });
  } else {
    output({ installed: installed.map(pluginId => ({ pluginId, installed: true,
      enabled: pluginId !== process.env.DISABLED_PLUGIN + '@filippo-skills' })) });
  }
}
`;

function runSmoke(harness, env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-smoke-'));
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return target;
  };
  try {
    assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
    const script = `test-${harness === 'pi' ? 'pi-package' : 'codex-marketplace'}.sh`;
    write(`scripts/${script}`, fs.readFileSync(path.join(__dirname, script)));
    write('scripts/test-codex-hooks.mjs', '// Hook behavior is covered by the real CLI smoke.\n');
    write('scripts/codex-smoke-warnings.js', fs.readFileSync(path.join(__dirname, 'codex-smoke-warnings.js')));
    const names = ['tdd', 'code-review', 'domain-modeling', 'new-upstream-skill'];
    for (const name of names) write(`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Fixture\n---\n`);
    write('.agents/plugins/marketplace.json', JSON.stringify({ plugins: names.map(name => ({ name })) }));
    write('docs/pi-package-filters.md', '## `matt-pocock-bundle`\n\n```json\n' +
      JSON.stringify({ packages: [{ source: 'fixture', skills: names.slice(0, 3).map(name => '+skills/' + name) }] }) + '\n```\n');
    fs.chmodSync(write(`bin/${harness}`, mockCli), 0o755);
    return spawnSync('bash', [`scripts/${script}`], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, ...env },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const harness of ['pi', 'codex']) {
  test(`${harness} smoke includes a newly generated skill/plugin without a hardcoded list`, () => {
    const result = runSmoke(harness);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all 4 generated/);
  });
}

test('pi smoke fails when a newly generated skill is not loaded', () => {
  const result = runSmoke('pi', { MISSING_SKILL: 'new-upstream-skill' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated skill did not load.*new-upstream-skill/);
});

test('Codex smoke fails when a newly generated plugin is unavailable', () => {
  assert.notEqual(runSmoke('codex', { MISSING_PLUGIN: 'new-upstream-skill' }).status, 0);
});

test('Codex smoke fails when a newly generated plugin installs disabled', () => {
  assert.notEqual(runSmoke('codex', { DISABLED_PLUGIN: 'new-upstream-skill' }).status, 0);
});
