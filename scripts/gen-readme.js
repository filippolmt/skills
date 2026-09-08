#!/usr/bin/env node
// gen-readme — render the README's two generated regions from marketplace.json.
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
// The BUNDLE PROJECTION is the second region, between
//   <!-- bundles:start -->  …  <!-- bundles:end -->
// Its rows come from each bundle's own `dependencies`. Why it exists, why it
// sits beside the install instructions and why its content is disjoint from the
// catalog's: docs/adr/0012-the-bundle-table-lives-next-to-the-install.md.
//
// Usage:
//   node scripts/gen-readme.js          # rewrite README.md in place
//   node scripts/gen-readme.js --check  # exit 1 if README is out of sync (no write)
//
// renderCatalog() and renderBundles() are pure functions returning markdown,
// exported for the test. The file IO lives only in the CLI wrapper below —
// including deriving which entries are bundles, which needs the filesystem.

const fs = require('fs');
const path = require('path');
const { readCatalog, isLocal, isBundle, repoOf, root } = require('./catalog.js');

const START = '<!-- catalog:start -->';
const END = '<!-- catalog:end -->';
const BUNDLES_START = '<!-- bundles:start -->';
const BUNDLES_END = '<!-- bundles:end -->';

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
    // One per line: descriptions end in a full stop, so joining them inline
    // produced `…on purpose.; \`mode-router\` — …`.
    out.push(['**Local:**', ...locals.map((p) => `- \`${p.name}\` — ${p.description}`)].join('\n'));
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

// Pure: build the bundle projection from `[{ name, dependencies }]`, in catalog
// order. A bundle declaring no dependencies renders an empty cell rather than
// throwing — a plugin that ships nothing AND pulls nothing in is a mistake to
// catch in review, not a reason to fail the build.
function renderBundles(bundles) {
  const rows = bundles.map(
    (b) => `| \`${b.name}\` | ${(b.dependencies || []).map((d) => `\`${d}\``).join(', ')} |`
  );
  return table(['Bundle', 'What it installs with it'], rows);
}

// Replace the text between a marker pair with `body`, keeping the markers.
// Defaults to the catalog pair; the bundle pair is passed in explicitly.
function replaceBetweenMarkers(readme, body, start = START, end = END) {
  const i = readme.indexOf(start);
  const j = readme.indexOf(end);
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`README.md is missing the ${start} / ${end} markers`);
  }
  return readme.slice(0, i + start.length) + '\n' + body + '\n' + readme.slice(j);
}

module.exports = {
  renderCatalog,
  renderBundles,
  table,
  replaceBetweenMarkers,
  START,
  END,
  BUNDLES_START,
  BUNDLES_END,
};

if (require.main === module) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  // A local entry's manifest, read once here: both the drift guard and the
  // bundle projection want it.
  const manifestOf = (entry) => JSON.parse(read(path.join(entry.source, '.claude-plugin/plugin.json')));
  const catalog = readCatalog();
  const meta = JSON.parse(read('scripts/catalog-meta.json'));
  const routerManifest = JSON.parse(read('plugins/mode-router/.claude-plugin/plugin.json'));
  const modes = routerManifest.dependencies || [];

  // Each local plugin's description is copied verbatim into the catalog, so it can
  // drift from the manifest it was copied from. Catch that here, not in review.
  const drifted = catalog.plugins
    .filter(isLocal)
    .filter((e) => manifestOf(e).description !== e.description);
  if (drifted.length) {
    for (const e of drifted) {
      console.error(
        `description drift for \`${e.name}\`: marketplace.json and ` +
          `${e.source}/.claude-plugin/plugin.json disagree.`
      );
    }
    process.exit(1);
  }

  // One derived set drives both regions: subtracted from the catalog projection,
  // selected for the bundle projection. Resolved here rather than inside the
  // renderers, which stay pure functions of their inputs.
  const bundleEntries = catalog.plugins.filter(isBundle);
  const omit = (meta.omit || []).concat(bundleEntries.map((p) => p.name));
  const bundles = bundleEntries.map((e) => ({
    name: e.name,
    dependencies: manifestOf(e).dependencies || [],
  }));

  const readmePath = path.join(root, 'README.md');
  const current = fs.readFileSync(readmePath, 'utf8');
  let next = replaceBetweenMarkers(current, renderCatalog(catalog, { ...meta, omit }, modes));
  next = replaceBetweenMarkers(next, renderBundles(bundles), BUNDLES_START, BUNDLES_END);

  if (process.argv.includes('--check')) {
    if (current !== next) {
      console.error(
        'README.md generated regions are out of sync. Run: node scripts/gen-readme.js'
      );
      process.exit(1);
    }
    console.log('README.md generated regions are in sync.');
    process.exit(0);
  }

  if (current === next) {
    console.log('README.md generated regions already up to date.');
  } else {
    fs.writeFileSync(readmePath, next);
    console.log('README.md generated regions regenerated.');
  }
}
