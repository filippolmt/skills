#!/usr/bin/env node
// Generate the installable Codex marketplace from the validated shared inventory.
// It packages every supported runtime closure, reusing pi's portable conversions
// and applying Codex-specific skill, agent, and hook adaptations where declared.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readCatalog, root } = require('./catalog.js');
const { generate } = require('./gen-distribution.js');
const { parseFrontmatter, treeFingerprint } = require('./gen-skills-tree.js');
const { addProvenance, convertedSkillName, copySelfContained, validateSkillDirectories, writeConvertedSkill } = require('./portable-artifacts.js');

const OUTPUT = path.join(root, '.agents', 'plugins');
const META = path.join(root, 'scripts', 'distribution-meta.json');

const codexOutcome = (artifact) => artifact.dispositions.codex;
const unsupported = (entry) => entry.artifacts.every((artifact) => codexOutcome(artifact).disposition === 'unsupported');

function packageable(entry) {
  if (unsupported(entry)) return false;
  return entry.artifacts.every((artifact) =>
    codexOutcome(artifact).disposition === 'unsupported' ||
    ['skill', 'command', 'agent', 'hook', 'bundle'].includes(artifact.kind)
  );
}

function closure(name, byName, trail = []) {
  if (trail.includes(name)) throw new Error(`Codex package dependency cycle: ${[...trail, name].join(' -> ')}`);
  const entry = byName.get(name);
  if (!entry || !packageable(entry)) return null;
  const result = [entry];
  for (const dependency of entry.runtimeDependencies) {
    const target = byName.get(dependency);
    if (target && unsupported(target)) continue;
    const nested = closure(dependency, byName, [...trail, name]);
    if (!nested) return null;
    result.push(...nested);
  }
  return [...new Map(result.map((item) => [item.name, item])).values()];
}

function rewritePluginPaths(value) {
  if (typeof value === 'string') {
    return value
      .replaceAll('.codex/skills/', '${PLUGIN_ROOT}/skills/')
      .replaceAll('.agents/skills/', '${PLUGIN_ROOT}/skills/')
      .replaceAll('.codex\\\\skills\\\\', '${PLUGIN_ROOT}\\\\skills\\\\')
      .replaceAll('.agents\\\\skills\\\\', '${PLUGIN_ROOT}\\\\skills\\\\');
  }
  if (Array.isArray(value)) return value.map(rewritePluginPaths);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewritePluginPaths(item)]));
  return value;
}

function writeHooks(entries, packageRoot) {
  const hooks = {};
  for (const entry of entries) {
    for (const artifact of entry.artifacts.filter((item) => item.kind === 'hook' && codexOutcome(item).disposition === 'adapted')) {
      const outcome = codexOutcome(artifact);
      if (!outcome.sourcePath) throw new Error(`${entry.name}/${artifact.id}: adapted hook requires sourcePath`);
      const match = artifact.id.match(/#([^[]+)\[(\d+)\]$/);
      if (!match) throw new Error(`${entry.name}/${artifact.id}: invalid hook artifact id`);
      const [, event, index] = match;
      const source = JSON.parse(fs.readFileSync(path.join(entry.repoRoot, outcome.sourcePath), 'utf8'));
      const registration = source.hooks?.[event]?.[Number(index)];
      if (!registration) throw new Error(`${entry.name}/${artifact.id}: adaptation source has no matching hook`);
      (hooks[event] ||= []).push(rewritePluginPaths(registration));
    }
  }
  if (!Object.keys(hooks).length) return;
  const dir = path.join(packageRoot, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks.json'), `${JSON.stringify({ hooks }, null, 2)}\n`);
}

function validateCodexPackages(packages) {
  for (const item of fs.readdirSync(packages, { withFileTypes: true })) {
    if (!item.isDirectory()) throw new Error(`unexpected generated package entry: ${item.name}`);
    const packageRoot = path.join(packages, item.name);
    const skills = path.join(packageRoot, 'skills');
    if (!fs.existsSync(skills)) throw new Error(`${item.name}: generated package has no skills directory`);
    validateSkillDirectories(skills);

    const manifestFile = path.join(packageRoot, 'plugin.json');
    if (!fs.existsSync(manifestFile)) throw new Error(`${item.name}: missing plugin.json`);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.name !== item.name || typeof manifest.version !== 'string' || manifest.skills !== './skills/') {
      throw new Error(`${item.name}: invalid plugin.json`);
    }
  }
}

function baseVersion(plugin, inventoryEntry) {
  if (typeof plugin.source === 'object') {
    const match = String(plugin.source.ref || '').match(/(?:^|-)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
    return match ? match[1] : '0.0.0';
  }
  const manifest = path.join(inventoryEntry.sourceRoot, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifest)) return '0.0.0';
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || '0.0.0';
}

function writeCodexDistribution(plugins, inventory, output) {
  const catalog = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const byName = new Map(inventory.map((entry) => [entry.name, entry]));
  const packages = path.join(output, 'packages');
  fs.rmSync(packages, { recursive: true, force: true });
  fs.mkdirSync(packages, { recursive: true });

  const marketplacePlugins = [];
  const written = [];
  const omitted = [];

  for (const plugin of plugins) {
    const entry = byName.get(plugin.name);
    const entries = entry && closure(plugin.name, byName);
    if (!entries) {
      omitted.push(plugin.name);
      continue;
    }

    const packageRoot = path.join(packages, plugin.name);
    const skillsRoot = path.join(packageRoot, 'skills');
    const names = new Set();
    for (const member of entries) {
      for (const artifact of member.artifacts.filter((item) => item.kind === 'skill' && codexOutcome(item).disposition !== 'unsupported')) {
        const outcome = codexOutcome(artifact);
        const skillFile = outcome.sourcePath
          ? path.join(member.repoRoot, outcome.sourcePath)
          : path.join(member.sourceRoot, artifact.path);
        const frontmatter = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
        if (!frontmatter.name) throw new Error(`${member.name}/${artifact.path}: skill has no name`);
        const projected = path.join(root, 'skills', frontmatter.name);
        const source = outcome.disposition === 'native' && fs.existsSync(path.join(projected, 'SKILL.md'))
          ? projected
          : path.dirname(skillFile);
        if (names.has(frontmatter.name)) throw new Error(`${plugin.name}: duplicate runtime skill ${frontmatter.name}`);
        names.add(frontmatter.name);
        const destination = path.join(skillsRoot, frontmatter.name);
        copySelfContained(source, destination);
        if (outcome.sourcePath) addProvenance(member, catalog.get(member.name), destination, outcome.sourcePath, 'Used the upstream Codex-specific Agent Skill payload.');
      }
      for (const artifact of member.artifacts.filter((item) => ['command', 'agent'].includes(item.kind) && codexOutcome(item).disposition === 'adapted' && !codexOutcome(item).sourcePath)) {
        const name = convertedSkillName(member, artifact);
        if (names.has(name)) throw new Error(`${plugin.name}: duplicate runtime skill ${name}`);
        const projected = path.join(root, 'skills', name);
        if (fs.existsSync(path.join(projected, 'SKILL.md'))) {
          copySelfContained(projected, path.join(skillsRoot, name));
          names.add(name);
        } else {
          names.add(writeConvertedSkill(member, catalog.get(member.name), artifact, path.join(skillsRoot, name)));
        }
      }
    }
    writeHooks(entries, packageRoot);

    const sourceId = typeof plugin.source === 'object' ? plugin.source.sha.slice(0, 12) : 'local';
    const fingerprint = crypto.createHash('sha256')
      .update(treeFingerprint(packageRoot))
      .update(JSON.stringify({ name: plugin.name, description: plugin.description, dependencies: entries.map((item) => item.name) }))
      .digest('hex').slice(0, 12);
    const manifest = {
      name: plugin.name,
      version: `${baseVersion(plugin, entry)}+catalog.${sourceId}.${fingerprint}`,
      description: plugin.description,
      author: plugin.author,
      repository: typeof plugin.source === 'object' ? plugin.source.url : undefined,
      skills: './skills/',
    };
    for (const key of Object.keys(manifest)) if (manifest[key] === undefined) delete manifest[key];
    fs.writeFileSync(path.join(packageRoot, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    marketplacePlugins.push({
      name: plugin.name,
      source: { source: 'local', path: `./.agents/plugins/packages/${plugin.name}` },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Developer Tools',
    });
    written.push(plugin.name);
  }

  validateCodexPackages(packages);

  const marketplace = {
    name: 'filippo-skills',
    interface: { displayName: 'Filippo Skills' },
    plugins: marketplacePlugins,
  };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
  return { written, omitted };
}

module.exports = { validateCodexPackages, writeCodexDistribution };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const metadata = JSON.parse(fs.readFileSync(META, 'utf8'));
  const { plugins } = readCatalog();
  const { inventory } = generate(plugins, metadata);
  if (check) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-marketplace-'));
    try {
      writeCodexDistribution(plugins, inventory, temp);
      if (treeFingerprint(temp) !== treeFingerprint(OUTPUT)) {
        console.error('Codex marketplace is out of date. Run: node scripts/gen-codex.js');
        process.exit(1);
      }
      console.log('Codex marketplace is in sync.');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  } else {
    const result = writeCodexDistribution(plugins, inventory, OUTPUT);
    console.log(`Codex marketplace generated (${result.written.length} plugins; ${result.omitted.length} awaiting adaptations).`);
  }
}
