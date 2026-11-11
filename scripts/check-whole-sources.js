#!/usr/bin/env node
// check-whole-sources — find upstream skills a whole source ships with no entry.
//
// ADR-0014 says a whole source has every upstream skill catalogued unless it is a
// listed exclusion, but nothing enforced it: Renovate moves the `sha`, regeneration
// prunes what upstream deleted, and a skill upstream ADDED stays out until someone
// runs `/add-external-skill update`. Six had piled up unnoticed (ADR-0024). This
// reports them; adding an entry stays a human edit, because it needs a description
// and sometimes an exclusion decision.
//
// Reads the pinned `sha`, not upstream HEAD: a new skill shows up here once Renovate
// has moved the series past it, which is also when the entry could pin it.
//
// With --curated it reports the curated sources instead (ADR-0039): a skill present
// at the pinned `sha` and absent, at the same path, at the repo's curation baseline
// is one no human has looked at yet.
//
// Usage: node scripts/check-whole-sources.js   (exit 1 when a skill is missing)
//        node scripts/check-whole-sources.js --curated   (exit 1 when a curated
//        source ships a skill past its curation baseline)
//        node scripts/check-whole-sources.js --classified   (offline: exit 1 when an
//        external repo has no ADR-0014 row, since an unclassified repo is never reported,
//        or when a curated source and the curation baselines disagree)
// Set GITHUB_TOKEN, or log in with gh, to lift the anonymous GitHub API rate limit.

const fs = require('fs');
const path = require('path');
const { readCatalog, readCatalogMeta, isExternal, entryPath, repoOf, root } = require('./catalog.js');
const { githubApi } = require('./github.js');

const ADR = path.join(root, 'docs', 'adr', '0014-each-source-repo-is-whole-or-curated.md');
const NO_BASELINE = 'curated source with no `curationBaseline` in scripts/catalog-meta.json';

// Both ADR tables are rows of backticked cells; the section heading tells them apart.
function parseAdr(text) {
  const sources = new Map();
  const exclusions = new Map();
  let section = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('### ')) section = line.slice(4).trim();
    const cells = line.startsWith('| `') ? line.split('|').slice(1, -1).map((c) => c.trim()) : null;
    if (!cells) continue;
    const repo = cells[0].replace(/`/g, '');
    if (section === 'Source repos') {
      if (sources.has(repo)) throw new Error(`ADR-0014 lists ${repo} twice under Source repos`);
      sources.set(repo, { kind: cells[1] });
    }
    if (section === 'Catalog exclusions') {
      const list = exclusions.get(repo) || [];
      list.push(...[...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
      exclusions.set(repo, list);
    }
  }
  return { sources, exclusions };
}

// Mirrors and fixtures are ADR-0014's "not every SKILL.md is a skill of the repo".
const FIXTURE = /(^|\/)(testdata|tests|benchmarks)\//;
const MIRROR = /(^|\/)(\.openclaw|\.cursor|cli\/assets)\//;
function isSkillOfRepo(dir, all) {
  if (FIXTURE.test(dir + '/') || MIRROR.test(dir + '/')) return false;
  const canonical = all.some((d) => d.startsWith('skills/'));
  if (canonical && (dir.startsWith('.claude/skills/') || /^plugins\/[^/]+\/skills\//.test(dir))) return false;
  return true;
}

const globToRegExp = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')}$`);
const excluded = (dir, patterns) => patterns.some((p) =>
  p.includes('/') ? globToRegExp(p).test(dir) : path.posix.basename(dir) === p);

const sourcesOfKind = (sources, kind) => [...sources].filter(([, s]) => s.kind === kind).map(([repo]) => repo);
const entriesOf = (catalog, repo) => catalog.filter((e) => repoOf(e) === repo);
const within = (dir, pluginRoot) => pluginRoot === '.' || dir === pluginRoot || dir.startsWith(`${pluginRoot}/`);

// Pure: for each whole source, the upstream skill folders with neither an entry nor
// an exclusion, and `path: null` for a whole source with no entry at all. A source
// whose entries are all whole-plugin entries is skipped — there the unit is the
// plugin — and a skill inside a whole-plugin entry's root counts as catalogued.
// Whole-plugin is read off upstream (a `.claude-plugin/plugin.json` at the entry's
// path), not off the ADR's prose.
function uncatalogued({ sources, exclusions, catalog, upstream }) {
  const missing = [];
  for (const repo of sourcesOfKind(sources, 'whole')) {
    const entries = entriesOf(catalog, repo);
    if (entries.length === 0) {
      missing.push({ repo, path: null });
      continue;
    }
    for (const dir of unentered(repo, entries, upstream.get(repo), exclusions)) missing.push({ repo, path: dir });
  }
  return missing;
}

// Skill folders of one repo's tree with neither an entry nor an exclusion; none when
// every entry is a whole-plugin entry, since there the unit is the plugin.
function unentered(repo, entries, { skills, plugins }, exclusions) {
  const pluginRoots = entries.map(entryPath).filter((p) => plugins.has(p));
  if (pluginRoots.length === entries.length) return [];
  const have = new Set(entries.map(entryPath));
  return skills.filter((dir) => !have.has(dir)
    && !pluginRoots.some((pluginRoot) => within(dir, pluginRoot))
    && isSkillOfRepo(dir, skills) && !excluded(dir, exclusions.get(repo) || []));
}

// Pure: for each curated source, the skill folders `unentered` finds at the pinned sha
// that are absent, at the same path, at its curation baseline (ADR-0039). A move
// counts as new: leaving `in-progress/` is when a skill becomes pickable.
function unreviewed({ sources, exclusions, catalog, trees }) {
  const missing = [];
  for (const repo of sourcesOfKind(sources, 'curated')) {
    const entries = entriesOf(catalog, repo);
    if (entries.length === 0) continue;
    const { pinned, baseline } = trees.get(repo);
    const seen = new Set(baseline.skills);
    for (const dir of unentered(repo, entries, pinned, exclusions)) {
      if (!seen.has(dir)) missing.push({ repo, path: dir });
    }
  }
  return missing;
}

// Pure: every curated source needs a curation baseline and an entry, and every baseline
// belongs to a curated source — a stale key or row would silently stop meaning anything.
function baselineMismatches({ sources, baselines, catalog }) {
  const curated = sourcesOfKind(sources, 'curated');
  return [
    ...curated.filter((repo) => entriesOf(catalog, repo).length === 0)
      .map((repo) => `\`${repo}\`: curated source with no catalog entry — remove its ADR-0014 row and its curation baseline`),
    ...curated.filter((repo) => !baselines[repo]).map((repo) => `\`${repo}\`: ${NO_BASELINE}`),
    ...Object.keys(baselines).filter((repo) => !curated.includes(repo))
      .map((repo) => `\`${repo}\`: curation baseline for a repo that is not a curated source`),
  ];
}

// Pure: external repos with no Source repos row. Such a repo is neither whole nor
// curated, so a skill its upstream adds is never reported (ADR-0014).
const unclassified = ({ sources, catalog }) =>
  [...new Set(catalog.map(repoOf))].filter((repo) => !sources.has(repo));

// The ADR-0014 tables and the external entries every mode starts from.
function readInputs() {
  return { ...parseAdr(fs.readFileSync(ADR, 'utf8')), catalog: readCatalog().plugins.filter(isExternal) };
}

// Prints a report and sets exit 1, or prints `clean` when there is nothing to report.
function report(clean, heading, lines, hint) {
  if (lines.length === 0) return console.log(clean);
  console.log(`${heading}\n${lines.join('\n')}\n\n${hint}`);
  process.exitCode = 1;
}

function checkClassified() {
  const { sources, catalog } = readInputs();
  const missing = unclassified({ sources, catalog });
  const mismatches = baselineMismatches({ sources, baselines: readCatalogMeta().curationBaseline || {}, catalog });
  if (missing.length === 0 && mismatches.length === 0) {
    console.log(`Every external repo has an ADR-0014 Source repos row (${sources.size} rows), every curated source a curation baseline.`);
    return;
  }
  if (missing.length) console.log(`External repos with no ADR-0014 Source repos row — classify each as whole or curated:\n${missing.map((r) => `- \`${r}\``).join('\n')}`);
  if (mismatches.length) console.log(`Curated sources and curation baselines disagree (ADR-0039):\n${mismatches.map((m) => `- ${m}`).join('\n')}`);
  process.exitCode = 1;
}

async function upstreamTree(repo, sha) {
  const body = await githubApi(`repos/${repo}/git/trees/${sha}?recursive=1`);
  if (body.truncated) throw new Error(`${repo}@${sha}: tree listing truncated, cannot tell what is missing`);
  const dirsOf = (file) => body.tree
    .filter((t) => t.type === 'blob' && (t.path === file || t.path.endsWith(`/${file}`)))
    .map((t) => t.path.slice(0, -file.length).replace(/\/$/, '') || '.');
  return { skills: dirsOf('SKILL.md'), plugins: new Set(dirsOf('.claude-plugin/plugin.json')) };
}

// Entries of one repo normally share a sha; if a bump left them apart, read each and
// take the union, so nothing pinned by any entry goes unseen.
// shortcut: a skill deleted between the two shas is still reported until every entry
// reaches the newer one; per-entry trees if that ever proves noisy.
async function pinnedTree(catalog, repo) {
  const merged = { skills: [], plugins: new Set() };
  for (const sha of new Set(entriesOf(catalog, repo).map((e) => e.source.sha))) {
    const { skills, plugins } = await upstreamTree(repo, sha);
    merged.skills = [...new Set([...merged.skills, ...skills])];
    for (const p of plugins) merged.plugins.add(p);
  }
  return merged;
}

async function checkCurated() {
  const { sources, exclusions, catalog } = readInputs();
  const baselines = readCatalogMeta().curationBaseline || {};
  const trees = new Map();
  for (const repo of sourcesOfKind(sources, 'curated')) {
    if (entriesOf(catalog, repo).length === 0) continue;
    // --classified guards this offline; here a missing baseline is a failure to look.
    if (!baselines[repo]) throw new Error(`${repo}: ${NO_BASELINE}`);
    trees.set(repo, { pinned: await pinnedTree(catalog, repo), baseline: await upstreamTree(repo, baselines[repo]) });
  }
  report(`No skill of ${trees.size} curated sources is past its curation baseline.`,
    'Curated sources ship skills past their curation baseline (ADR-0039):',
    unreviewed({ sources, exclusions, catalog, trees }).map((m) => `- \`${m.repo}\`: \`${m.path}\``),
    'Pick them with `/add-external-skill update <owner/repo>`, which moves the baseline; to decline, move the repo\'s `curationBaseline` in scripts/catalog-meta.json to its pinned sha, or list a reasoned exclusion in ADR-0014.');
}

async function checkWhole() {
  const { sources, exclusions, catalog } = readInputs();
  const upstream = new Map();
  for (const repo of sourcesOfKind(sources, 'whole')) upstream.set(repo, await pinnedTree(catalog, repo));
  report(`Every skill of ${upstream.size} whole sources is catalogued or excluded.`,
    'Whole sources ship skills with no catalog entry and no ADR-0014 exclusion:',
    uncatalogued({ sources, exclusions, catalog, upstream }).map((m) => (m.path === null
      ? `- \`${m.repo}\`: no catalog entry at all — add one, or reclassify the repo in ADR-0014`
      : `- \`${m.repo}\`: \`${m.path}\``)),
    'Add them with `/add-external-skill update <owner/repo>`, or list them as exclusions in ADR-0014.');
}

if (require.main === module && process.argv[2] === '--classified') {
  checkClassified();
} else if (require.main === module) {
  (process.argv[2] === '--curated' ? checkCurated() : checkWhole()).catch((err) => {
    console.error(err.message);
    process.exitCode = 2;
  });
}

module.exports = { parseAdr, uncatalogued, unreviewed, unclassified, baselineMismatches, upstreamTree, pinnedTree };
