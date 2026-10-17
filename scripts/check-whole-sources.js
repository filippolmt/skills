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
// Usage: node scripts/check-whole-sources.js   (exit 1 when a skill is missing)
// Set GITHUB_TOKEN to lift the anonymous GitHub API rate limit.

const fs = require('fs');
const path = require('path');
const { readCatalog, isGitSubdir, repoOf, root } = require('./catalog.js');

const ADR = path.join(root, 'docs', 'adr', '0014-each-source-repo-is-whole-or-curated.md');

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

const wholeSources = (sources) => [...sources].filter(([, { kind }]) => kind === 'whole').map(([repo]) => repo);
const entryPath = (e) => e.source.path || '.';
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
  for (const repo of wholeSources(sources)) {
    const entries = entriesOf(catalog, repo);
    if (entries.length === 0) {
      missing.push({ repo, path: null });
      continue;
    }
    const { skills, plugins } = upstream.get(repo);
    const pluginRoots = entries.map(entryPath).filter((p) => plugins.has(p));
    if (pluginRoots.length === entries.length) continue;
    const have = new Set(entries.map(entryPath));
    for (const dir of skills) {
      if (have.has(dir) || pluginRoots.some((pluginRoot) => within(dir, pluginRoot))) continue;
      if (!isSkillOfRepo(dir, skills) || excluded(dir, exclusions.get(repo) || [])) continue;
      missing.push({ repo, path: dir });
    }
  }
  return missing;
}

async function upstreamTree(repo, sha) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`, { headers });
  if (!res.ok) throw new Error(`${repo}@${sha}: GitHub API ${res.status}`);
  const body = await res.json();
  if (body.truncated) throw new Error(`${repo}@${sha}: tree listing truncated, cannot tell what is missing`);
  const dirsOf = (file) => body.tree
    .filter((t) => t.type === 'blob' && (t.path === file || t.path.endsWith(`/${file}`)))
    .map((t) => t.path.slice(0, -file.length).replace(/\/$/, '') || '.');
  return { skills: dirsOf('SKILL.md'), plugins: new Set(dirsOf('.claude-plugin/plugin.json')) };
}

async function main() {
  const { sources, exclusions } = parseAdr(fs.readFileSync(ADR, 'utf8'));
  const catalog = readCatalog().plugins.filter(isGitSubdir);
  const upstream = new Map();
  for (const repo of wholeSources(sources)) {
    // Entries of one repo normally share a sha; if a bump left them apart, read each
    // and take the union, so nothing pinned by any entry goes unseen.
    // shortcut: a skill deleted between the two shas is still reported until every
    // entry reaches the newer one; per-entry trees if that ever proves noisy.
    const shas = new Set(entriesOf(catalog, repo).map((e) => e.source.sha));
    const merged = { skills: [], plugins: new Set() };
    for (const sha of shas) {
      const { skills, plugins } = await upstreamTree(repo, sha);
      merged.skills = [...new Set([...merged.skills, ...skills])];
      for (const p of plugins) merged.plugins.add(p);
    }
    upstream.set(repo, merged);
  }
  const missing = uncatalogued({ sources, exclusions, catalog, upstream });
  if (missing.length === 0) {
    console.log(`Every skill of ${upstream.size} whole sources is catalogued or excluded.`);
    return;
  }
  console.log('Whole sources ship skills with no catalog entry and no ADR-0014 exclusion:');
  for (const m of missing) {
    console.log(m.path === null
      ? `- \`${m.repo}\`: no catalog entry at all — add one, or reclassify the repo in ADR-0014`
      : `- \`${m.repo}\`: \`${m.path}\``);
  }
  console.log('\nAdd them with `/add-external-skill update <owner/repo>`, or list them as exclusions in ADR-0014.');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 2;
  });
}

module.exports = { parseAdr, uncatalogued };
