// Shared read-only model of what each catalog entry distributes. Writers consume
// this inventory; they do not rediscover skills, commands, agents, hooks, or MCP.
const fs = require('fs');
const path = require('path');
const { isBundle } = require('./catalog.js');

const MANIFEST_METADATA = new Set([
  'name', 'version', 'description', 'author', 'homepage', 'repository', 'license',
  'keywords', 'skills', 'commands', 'agents', 'hooks', 'mcpServers', 'dependencies',
]);
const STATUSES = new Set(['native', 'adapted', 'unsupported']);
const posix = (p) => p.split(path.sep).join('/');

function filesUnder(dir, accept) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile() && accept(file)) out.push(file);
    }
  };
  walk(dir);
  return out;
}

function artifact(entry, root, kind, file, suffix = '') {
  const rel = posix(path.relative(root, file));
  return { entry: entry.name, kind, path: rel, id: `${kind}:${rel}${suffix}` };
}

function json(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${label} ${file}: ${error.message}`); }
}

function declaredDependencies(root) {
  const file = path.join(root, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(file)) return [];
  const dependencies = json(file, 'invalid plugin manifest').dependencies || [];
  if (!Array.isArray(dependencies) || dependencies.some((name) => typeof name !== 'string')) {
    throw new Error(`${file}: dependencies must be an array of catalog names`);
  }
  return dependencies;
}

function discoverArtifacts(entry, root) {
  if (isBundle(entry)) return [{ entry: entry.name, kind: 'bundle', path: null, id: 'bundle:dependencies' }];
  const manifestFile = path.join(root, '.claude-plugin', 'plugin.json');
  const plugin = fs.existsSync(manifestFile);
  const out = [];

  const skillRoot = plugin ? path.join(root, 'skills') : root;
  for (const file of filesUnder(skillRoot, (f) => path.basename(f) === 'SKILL.md')) {
    out.push(artifact(entry, root, 'skill', file));
  }
  if (plugin) {
    for (const [dir, kind] of [['commands', 'command'], ['agents', 'agent']]) {
      for (const file of filesUnder(path.join(root, dir), (f) => f.endsWith('.md'))) {
        out.push(artifact(entry, root, kind, file));
      }
    }
  }

  const hooksFile = path.join(root, 'hooks', 'hooks.json');
  if (fs.existsSync(hooksFile)) {
    const hooks = json(hooksFile, 'invalid hook configuration').hooks || {};
    for (const event of Object.keys(hooks).sort()) {
      const registrations = Array.isArray(hooks[event]) ? hooks[event] : [];
      registrations.forEach((_, i) => out.push(artifact(entry, root, 'hook', hooksFile, `#${event}[${i}]`)));
    }
  }

  for (const name of ['mcp.json', '.mcp.json']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const config = json(file, 'invalid MCP configuration');
    const servers = config.mcpServers || config;
    for (const server of Object.keys(servers).sort()) out.push(artifact(entry, root, 'mcp', file, `#${server}`));
  }

  if (plugin) {
    const manifest = json(manifestFile, 'invalid plugin manifest');
    for (const key of Object.keys(manifest).filter((key) => !MANIFEST_METADATA.has(key)).sort()) {
      out.push(artifact(entry, root, 'manifest-capability', manifestFile, `#${key}`));
    }
    for (const server of Object.keys(manifest.mcpServers || {}).sort()) {
      out.push(artifact(entry, root, 'mcp', manifestFile, `#mcpServers.${server}`));
    }
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const derived = {
  skill: {
    codex: { disposition: 'native', detail: 'Packaged as an Agent Skill.' },
    pi: { disposition: 'native', detail: 'Published in the root skills tree.' },
  },
  command: {
    codex: { disposition: 'adapted', detail: 'Converted to a deterministic namespaced skill.' },
    pi: { disposition: 'adapted', detail: 'Converted to a deterministic namespaced skill.' },
  },
  agent: {
    codex: { disposition: 'adapted', detail: 'Converted to a deterministic namespaced skill.' },
    pi: { disposition: 'adapted', detail: 'Converted to a deterministic namespaced skill.' },
  },
  mcp: {
    codex: { disposition: 'native', detail: 'Preserved as package MCP configuration.' },
    pi: { disposition: 'unsupported', limitation: 'pi packages cannot declare MCP servers.', fallback: 'Configure the server in pi settings.' },
  },
  bundle: {
    codex: { disposition: 'adapted', detail: 'Materialised as a self-contained plugin runtime closure.' },
    pi: { disposition: 'adapted', detail: 'Published as a generated package-filter snippet.' },
  },
};

function classify(item, metadata) {
  const key = `${item.entry}/${item.id}`;
  const decision = metadata.artifacts?.[key] || derived[item.kind];
  if (!decision) throw new Error(`${key}: unclassified ${item.kind} artifact`);
  for (const harness of ['codex', 'pi']) {
    const outcome = decision[harness];
    if (!outcome || !STATUSES.has(outcome.disposition)) throw new Error(`${key}: requires one Codex and one pi disposition`);
    if (outcome.disposition === 'adapted' && !outcome.detail) throw new Error(`${key}: adapted ${harness} disposition requires detail`);
    if (outcome.disposition === 'unsupported' && (!outcome.limitation || !outcome.fallback)) {
      throw new Error(`${key}: unsupported ${harness} disposition requires limitation and fallback`);
    }
  }
  return decision;
}

function validateDistribution(inventory, metadata = {}, options = {}) {
  const absent = new Set(options.absentEntries || []);
  const entries = new Set([...inventory.map((entry) => entry.name), ...absent]);
  const artifacts = new Set(inventory.flatMap((entry) => entry.artifacts.map((item) => `${entry.name}/${item.id}`)));
  for (const key of Object.keys(metadata.artifacts || {})) {
    const owner = key.split('/', 1)[0];
    if (!artifacts.has(key) && !absent.has(owner)) throw new Error(`orphaned artifact metadata: ${key}`);
  }
  for (const from of Object.keys(metadata.runtimeDependencies || {})) {
    if (!entries.has(from)) throw new Error(`orphaned runtime dependency source: ${from}`);
  }
  const result = inventory.map((entry) => {
    if (!entry.artifacts.length) throw new Error(`${entry.name}: no distribution artifacts discovered`);
    const runtimeDependencies = [...new Set([
      ...(entry.declaredDependencies || []),
      ...(metadata.runtimeDependencies?.[entry.name] || []),
    ])];
    for (const target of runtimeDependencies) if (!entries.has(target)) throw new Error(`${entry.name}: unknown dependency ${target}`);
    return {
      ...entry,
      runtimeDependencies,
      artifacts: entry.artifacts.map((item) => ({ ...item, dispositions: classify(item, metadata) })),
    };
  });

  const graph = new Map(result.map((entry) => [entry.name, entry.runtimeDependencies.filter((name) => !absent.has(name))]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (name, trail) => {
    if (visiting.has(name)) throw new Error(`runtime dependency cycle: ${[...trail, name].join(' -> ')}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const target of graph.get(name)) visit(target, [...trail, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of graph.keys()) visit(name, []);
  return result;
}

function describe(outcome) {
  const title = outcome.disposition[0].toUpperCase() + outcome.disposition.slice(1);
  if (outcome.disposition === 'unsupported') return `${title} — ${outcome.limitation} Fallback: ${outcome.fallback}`;
  return outcome.detail ? `${title} — ${outcome.detail}` : title;
}
const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

function renderParity(inventory) {
  const rows = [];
  for (const entry of inventory) {
    if (!entry.artifacts.length) throw new Error(`${entry.name}: no distribution artifacts discovered`);
    for (const item of entry.artifacts) {
      const dependencies = entry.runtimeDependencies.length ? entry.runtimeDependencies.map((name) => `\`${name}\``).join(', ') : '—';
      rows.push(`| \`${cell(entry.name)}\` | \`${cell(item.id)}\` | ${cell(dependencies)} | ${cell(describe(item.dispositions.codex))} | ${cell(describe(item.dispositions.pi))} |`);
    }
  }
  return [
    '# Distribution parity', '',
    '<!-- generated by `node scripts/gen-distribution.js`; do not edit -->', '',
    'Every catalog artifact has one required target outcome for Codex and pi. Claude Code reads the canonical marketplace directly; generated projections must realise these outcomes before they become user-facing.', '',
    '| Catalog entry | Artifact | Runtime dependencies | Codex | pi |',
    '| --- | --- | --- | --- | --- |',
    ...rows, '',
  ].join('\n');
}

module.exports = { discoverArtifacts, declaredDependencies, classify, validateDistribution, renderParity };
