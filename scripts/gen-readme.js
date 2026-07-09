#!/usr/bin/env node
// gen-readme — render the README "Available skills" catalog from marketplace.json.
//
// The catalog is a PROJECTION of three source-of-truth inputs:
//   - .claude-plugin/marketplace.json     — the plugin entries (names, descriptions, URLs)
//   - scripts/catalog-meta.json           — editorial ordering + per-repo taglines + omissions
//   - plugins/mode-router/.../plugin.json  — its `dependencies` define the "Modes" table
// The rendered markdown is spliced into README.md between the markers
//   <!-- catalog:start -->  …  <!-- catalog:end -->
// Every description is rendered VERBATIM from marketplace.json — the JSON is the
// single source of truth, so what you write there is what the README shows.
//
// Usage:
//   node scripts/gen-readme.js          # rewrite README.md in place
//   node scripts/gen-readme.js --check  # exit 1 if README is out of sync (no write)
//
// renderCatalog() is a pure function (marketplace, meta, modes) -> markdown string,
// exported for the test. The file IO lives only in the CLI wrapper below.

const fs = require('fs');
const path = require('path');

const START = '<!-- catalog:start -->';
const END = '<!-- catalog:end -->';

function repoOf(entry) {
  const s = entry && entry.source;
  if (!s || s.source !== 'git-subdir' || typeof s.url !== 'string') return null;
  return s.url.replace(/^https:\/\/github\.com\//, '');
}

function isLocal(entry) {
  return entry && typeof entry.source === 'string';
}

// A markdown table: header cells + already-formatted `| … |` body rows.
function table(cols, rows) {
  const header = `| ${cols.join(' | ')} |`;
  const sep = `|${cols.map(() => '---').join('|')}|`;
  return [header, sep, ...rows].join('\n');
}

// Pure: build the "Available skills" catalog markdown from the three inputs.
// `modes` is the ordered list of skill names the local mode-router plugin bundles.
function renderCatalog(marketplace, meta, modes) {
  const plugins = marketplace.plugins || [];
  const omit = new Set(meta.omit || []);
  const modeSet = new Set(modes || []);
  const out = [];

  // Local plugins (source is a path), minus anything explicitly omitted.
  const locals = plugins.filter((p) => isLocal(p) && !omit.has(p.name));
  if (locals.length) {
    const bullets = locals.map((p) => `\`${p.name}\` — ${p.description}`).join('; ');
    out.push(`**Local:** ${bullets}`);
  }

  // Grouped git-subdir entries, in the editorial order from catalog-meta.json.
  for (const g of meta.groups || []) {
    const entries = plugins.filter(
      (p) => repoOf(p) === g.repo && !omit.has(p.name) && !modeSet.has(p.name)
    );
    if (!entries.length) continue;
    const cols =
      g.kind === 'plugin' ? ['Plugin', 'What it bundles'] : ['Skill', 'What it does'];
    out.push(`### [${g.repo}](https://github.com/${g.repo}) — ${g.tagline}`);
    out.push(table(cols, entries.map((p) => `| \`${p.name}\` | ${p.description} |`)));
  }

  // Modes table — derived from the local mode-router plugin's dependencies.
  const modeEntries = (modes || [])
    .map((name) => plugins.find((p) => p.name === name))
    .filter(Boolean);
  if (modeEntries.length) {
    out.push('### Modes (bundled by the local `mode-router` plugin)');
    out.push(
      table(
        ['Skill', 'Source', 'What it does'],
        modeEntries.map((p) => {
          const repo = repoOf(p);
          const src = repo ? `[${repo}](https://github.com/${repo})` : '';
          return `| \`${p.name}\` | ${src} | ${p.description} |`;
        })
      )
    );
  }

  // Drift guard: every git-subdir entry must be classified (grouped, a mode, or omitted).
  const grouped = new Set((meta.groups || []).map((g) => g.repo));
  const unclassified = plugins
    .filter((p) => repoOf(p) && !omit.has(p.name) && !modeSet.has(p.name))
    .filter((p) => !grouped.has(repoOf(p)))
    .map((p) => `${p.name} (${repoOf(p)})`);
  if (unclassified.length) {
    throw new Error(
      `catalog-meta.json is missing a group for: ${unclassified.join(', ')}. ` +
        'Add the repo to "groups" (or the entry to "omit"/mode-router dependencies).'
    );
  }

  return out.join('\n\n');
}

// Replace the text between the START/END markers with `catalog`, keeping the markers.
function replaceBetweenMarkers(readme, catalog) {
  const i = readme.indexOf(START);
  const j = readme.indexOf(END);
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`README.md is missing the ${START} / ${END} markers`);
  }
  return readme.slice(0, i + START.length) + '\n' + catalog + '\n' + readme.slice(j);
}

module.exports = { renderCatalog, table, repoOf, replaceBetweenMarkers, START, END };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  const meta = JSON.parse(read('scripts/catalog-meta.json'));
  const routerManifest = JSON.parse(read('plugins/mode-router/.claude-plugin/plugin.json'));
  const modes = routerManifest.dependencies || [];

  const catalog = renderCatalog(marketplace, meta, modes);
  const readmePath = path.join(root, 'README.md');
  const current = fs.readFileSync(readmePath, 'utf8');
  const next = replaceBetweenMarkers(current, catalog);

  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error('README.md catalog is out of sync. Run: node scripts/gen-readme.js');
      process.exit(1);
    }
    console.log('README.md catalog is in sync.');
    process.exit(0);
  }

  if (current === next) {
    console.log('README.md catalog already up to date.');
  } else {
    fs.writeFileSync(readmePath, next);
    console.log('README.md catalog regenerated.');
  }
}
