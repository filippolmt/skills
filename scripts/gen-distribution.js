#!/usr/bin/env node
// Inventory and validate cross-harness artifacts. The parity document is a
// projection; distribution-meta.json contains only non-derivable decisions.
const fs = require('fs');
const path = require('path');
const { readCatalog, isLocal, root } = require('./catalog.js');
const { resolveEntry } = require('./gen-skills-tree.js');
const { discoverArtifacts, declaredDependencies, validateDistribution, renderParity } = require('./distribution.js');

const META = path.join(root, 'scripts', 'distribution-meta.json');
const PARITY = path.join(root, 'docs', 'distribution-parity.md');

function buildInventory(plugins, deps = {}) {
  const resolve = deps.resolveEntry || resolveEntry;
  const missing = [];
  const inventory = [];
  for (const entry of plugins) {
    let dir;
    let repoRoot;
    if (isLocal(entry)) {
      dir = path.join(root, entry.source);
      repoRoot = root;
    } else {
      const source = resolve(entry);
      if (!source.exists) { missing.push(entry.name); continue; }
      dir = source.abs;
      repoRoot = source.repoDir;
    }
    inventory.push({
      name: entry.name,
      repoRoot,
      declaredDependencies: declaredDependencies(dir),
      artifacts: discoverArtifacts(entry, dir),
    });
  }
  return { inventory, missing };
}

function validatePackageRoots(plugins, packagesDir) {
  if (!fs.existsSync(packagesDir)) return;
  const catalog = new Set(plugins.map((entry) => entry.name));
  for (const item of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (item.isDirectory() && !catalog.has(item.name)) throw new Error(`generated package has no catalog entry: ${item.name}`);
  }
}

function generate(plugins, metadata, deps = {}, options = {}) {
  const { inventory, missing } = buildInventory(plugins, deps);
  if (missing.length && !options.allowMissing) throw new Error(`catalog paths do not resolve: ${missing.join(', ')}`);
  return {
    inventory: validateDistribution(inventory, metadata, { absentEntries: options.allowMissing ? missing : [] }),
    missing,
  };
}

module.exports = { buildInventory, validatePackageRoots, generate };

if (require.main === module) {
  const verify = process.argv.includes('--verify');
  const check = process.argv.includes('--check');
  if (verify && check) throw new Error('choose --verify or --check');
  const metadata = JSON.parse(fs.readFileSync(META, 'utf8'));
  const { plugins } = readCatalog();
  validatePackageRoots(plugins, path.join(root, '.agents', 'plugins', 'packages'));
  const result = generate(plugins, metadata, {}, { allowMissing: verify });
  if (result.missing.length) {
    console.log(`removed upstream, omitted until regeneration prunes them: ${result.missing.join(', ')}`);
  }
  if (verify) {
    console.log(`${result.inventory.length} catalog entries have classified Codex and pi artifacts.`);
    process.exit(0);
  }
  const output = renderParity(result.inventory);
  if (check) {
    if (fs.existsSync(PARITY) && fs.readFileSync(PARITY, 'utf8') === output) {
      console.log('docs/distribution-parity.md is in sync.');
      process.exit(0);
    }
    console.error('docs/distribution-parity.md is out of date. Run: node scripts/gen-distribution.js');
    process.exit(1);
  }
  fs.writeFileSync(PARITY, output);
  console.log(`docs/distribution-parity.md generated (${result.inventory.length} entries).`);
}
