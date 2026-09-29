#!/usr/bin/env node
// prune-removed — drop the catalog entries whose upstream folder is gone.
//
// Renovate bumps a `sha`; if upstream deleted (or renamed) a skill at that sha,
// `gen-skills-tree.js --verify-paths` fails and the PR stays red forever, holding
// back every other entry from the same repo. This is the other half: it takes the
// same verdict — the entries `build()` could not resolve — and removes them.
//
// Removing an entry also means:
//   - its name leaves every local plugin's `dependencies` (a bundle pulling in a
//     plugin that no longer exists fails to install), and that plugin's `version`
//     takes a breaking bump — minor below 1.0.0, major above (CLAUDE.md);
//   - the README is regenerated, since both of its regions derive from the catalog.
//
// It never decides whether the removal is right — a rename looks exactly like a
// delete from here. The `prune-removed` workflow proposes the result as a PR a
// human merges; see .github/workflows/prune-removed.yml.
//
// Usage: node scripts/prune-removed.js   # prints the pruned names, one per line

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readCatalog, isLocal, root } = require('./catalog.js');
const { build } = require('./gen-skills-tree.js');

// --- pure ------------------------------------------------------------------

const breakingBump = (v) => {
  const [maj, min] = v.split('.').map(Number);
  return maj < 1 ? `0.${min + 1}.0` : `${maj + 1}.0.0`;
};

// The manifest without the gone dependencies, version bumped — or null when it
// listed none of them and so stays untouched.
function pruneManifest(manifest, gone) {
  const deps = manifest.dependencies || [];
  const kept = deps.filter((d) => !gone.includes(d));
  if (kept.length === deps.length) return null;
  return { ...manifest, version: breakingBump(manifest.version), dependencies: kept };
}

module.exports = { breakingBump, pruneManifest };

// --- cli -------------------------------------------------------------------

if (require.main === module) {
  const { text, plugins } = readCatalog();
  let gone = [];
  try {
    build(null, plugins);
  } catch (e) {
    if (!e.gone) throw e;
    gone = e.gone;
  }
  if (!gone.length) process.exit(0);

  const doc = JSON.parse(text);
  doc.plugins = doc.plugins.filter((p) => !gone.includes(p.name));
  // `JSON.stringify(_, null, 2)` is the file's own format: key order survives, so
  // the Renovate regexes keep matching the entries that remain.
  const write = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
  write(path.join(root, '.claude-plugin', 'marketplace.json'), doc);

  for (const p of doc.plugins.filter(isLocal)) {
    const file = path.join(root, p.source, '.claude-plugin', 'plugin.json');
    const pruned = pruneManifest(JSON.parse(fs.readFileSync(file, 'utf8')), gone);
    if (pruned) write(file, pruned);
  }

  execFileSync('node', [path.join(root, 'scripts', 'gen-readme.js')], { stdio: 'ignore' });
  console.log(gone.join('\n'));
}
