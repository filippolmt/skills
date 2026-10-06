const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateCodexPackages, writeCodexDistribution } = require('./gen-codex.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-distribution-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'skill-one', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skill-one', 'SKILL.md'), '---\nname: one\ndescription: One.\n---\n');
  fs.writeFileSync(path.join(root, 'shared', 'tool.js'), 'console.log("ok");\n');
  fs.symlinkSync(path.join(root, 'shared', 'tool.js'), path.join(source, 'skill-one', 'scripts', 'tool.js'));
  return { root, source };
}

test('writes an installable marketplace package from the shared inventory', () => {
  const { root, source } = fixture();
  const out = path.join(root, '.agents', 'plugins');
  const plugins = [{
    name: 'one',
    description: 'One skill.',
    author: { name: 'Author', url: 'https://example.test' },
    source: { source: 'git-subdir', url: 'https://github.com/example/skills', ref: 'v1.2.3', sha: 'abcdef1234567890' },
  }];
  const inventory = [{
    name: 'one',
    sourceRoot: source,
    runtimeDependencies: [],
    artifacts: [{
      kind: 'skill',
      path: 'skill-one/SKILL.md',
      dispositions: { codex: { disposition: 'native' } },
    }],
  }];

  try {
    const result = writeCodexDistribution(plugins, inventory, out);
    const marketplace = JSON.parse(fs.readFileSync(path.join(out, 'marketplace.json')));
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'packages', 'one', 'plugin.json')));

    assert.deepEqual(result, { written: ['one'], omitted: [] });
    assert.equal(marketplace.name, 'filippo-skills');
    assert.equal(marketplace.plugins[0].source.path, './.agents/plugins/packages/one');
    assert.equal(manifest.name, 'one');
    assert.match(manifest.version, /^1\.2\.3\+catalog\.abcdef123456\.[a-f0-9]{12}$/);
    assert.equal(manifest.skills, './skills/');
    assert.ok(fs.existsSync(path.join(out, 'packages', 'one', 'skills', 'one', 'SKILL.md')));
    assert.equal(fs.lstatSync(path.join(out, 'packages', 'one', 'skills', 'one', 'scripts', 'tool.js')).isSymbolicLink(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves MCP server configuration in the Codex package', () => {
  const { root, source } = fixture();
  const out = path.join(root, '.agents', 'plugins');
  fs.writeFileSync(path.join(source, 'mcp.json'), JSON.stringify({ mcpServers: { docs: { url: 'https://example.test/mcp' } } }));
  const plugins = [{ name: 'one', description: 'One.', source: './plugins/one' }];
  const inventory = [{
    name: 'one', sourceRoot: source, repoRoot: root, runtimeDependencies: [],
    artifacts: [
      { kind: 'skill', path: 'skill-one/SKILL.md', dispositions: { codex: { disposition: 'native' } } },
      { kind: 'mcp', id: 'mcp:mcp.json#docs', path: 'mcp.json', dispositions: { codex: { disposition: 'native' } } },
    ],
  }];
  try {
    assert.deepEqual(writeCodexDistribution(plugins, inventory, out), { written: ['one'], omitted: [] });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'packages', 'one', 'mcp.json'))), {
      mcpServers: { docs: { url: 'https://example.test/mcp' } },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('converts a Claude agent into a namespaced Codex skill', () => {
  const { root, source } = fixture();
  const out = path.join(root, '.agents', 'plugins');
  fs.writeFileSync(path.join(source, 'reviewer.md'), '---\nname: reviewer\ndescription: Review changes.\n---\n\n# Reviewer\n');
  const plugins = [{ name: 'one', description: 'One.', source: './plugins/one' }];
  const inventory = [{
    name: 'one',
    sourceRoot: source,
    repoRoot: root,
    runtimeDependencies: [],
    artifacts: [{ kind: 'agent', path: 'reviewer.md', dispositions: { codex: { disposition: 'adapted' } } }],
  }];

  try {
    assert.deepEqual(writeCodexDistribution(plugins, inventory, out), { written: ['one'], omitted: [] });
    const skill = fs.readFileSync(path.join(out, 'packages', 'one', 'skills', 'one-reviewer', 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: one-reviewer\ndescription: "Review changes\."/);
    assert.match(skill, /# Reviewer/);
    assert.ok(fs.existsSync(path.join(out, 'packages', 'one', 'skills', 'one-reviewer', 'SOURCE.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid generated skills and escaping symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-validation-'));
  const packageRoot = path.join(root, 'one');
  const skillRoot = path.join(packageRoot, 'skills', 'one');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'plugin.json'), '{}');
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: Wrong_Name\ndescription: One.\n---\n');
  assert.throws(() => validateCodexPackages(root), /invalid skill name/);

  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '---\nname: one\ndescription: One.\n---\n');
  fs.symlinkSync('/tmp', path.join(skillRoot, 'outside'));
  assert.throws(() => validateCodexPackages(root), /generated package contains symlink/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('omits entries whose Codex behavior is unsupported', () => {
  const { root, source } = fixture();
  const out = path.join(root, '.agents', 'plugins');
  const plugins = [{ name: 'one', description: 'One.', source: './plugins/one' }];
  const inventory = [{
    name: 'one',
    sourceRoot: source,
    runtimeDependencies: [],
    artifacts: [{ kind: 'hook', path: 'hooks.json', dispositions: { codex: { disposition: 'unsupported' } } }],
  }];

  try {
    assert.deepEqual(writeCodexDistribution(plugins, inventory, out), { written: [], omitted: ['one'] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
