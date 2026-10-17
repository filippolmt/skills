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
    if (section === 'Source repos') sources.set(repo, { kind: cells[1], notes: cells[2] || '' });
    if (section === 'Catalog exclusions') {
      const list = exclusions.get(repo) || [];
      list.push(...[...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
      exclusions.set(repo, list);
    }
  }
  return { sources, exclusions };
}

// Mirrors and fixtures are ADR-0014's "not every SKILL.md is a skill of the repo".
const FIXTURE = /(^|\/)(testdata|tests?|benchmarks|fixtures)\//;
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

// Pure: for each whole source, the upstream skill folders with neither an entry nor
// an exclusion. Whole-plugin sources are skipped — there the unit is the plugin.
function uncatalogued({ sources, exclusions, catalog, upstream }) {
  const missing = [];
  for (const [repo, { kind, notes }] of sources) {
    if (kind !== 'whole' || /whole-plugin/.test(notes) || !upstream.has(repo)) continue;
    const have = new Set(catalog.filter((e) => repoOf(e) === repo).map((e) => e.source.path || '.'));
    const all = upstream.get(repo);
    for (const dir of all) {
      if (have.has(dir) || !isSkillOfRepo(dir, all) || excluded(dir, exclusions.get(repo) || [])) continue;
      missing.push({ repo, path: dir });
    }
  }
  return missing;
}

async function skillDirs(repo, sha) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`, { headers });
  if (!res.ok) throw new Error(`${repo}@${sha}: GitHub API ${res.status}`);
  const body = await res.json();
  if (body.truncated) throw new Error(`${repo}@${sha}: tree listing truncated, cannot tell what is missing`);
  return body.tree
    .filter((t) => t.type === 'blob' && /(^|\/)SKILL\.md$/.test(t.path))
    .map((t) => path.posix.dirname(t.path));
}

async function main() {
  const { sources, exclusions } = parseAdr(fs.readFileSync(ADR, 'utf8'));
  const catalog = readCatalog().plugins.filter(isGitSubdir);
  const upstream = new Map();
  for (const [repo, { kind, notes }] of sources) {
    if (kind !== 'whole' || /whole-plugin/.test(notes)) continue;
    const entry = catalog.find((e) => repoOf(e) === repo);
    if (!entry) throw new Error(`ADR-0014 lists ${repo} as a whole source, but the catalog has no entry from it`);
    upstream.set(repo, await skillDirs(repo, entry.source.sha));
  }
  const missing = uncatalogued({ sources, exclusions, catalog, upstream });
  if (missing.length === 0) {
    console.log(`Every skill of ${upstream.size} whole sources is catalogued or excluded.`);
    return;
  }
  console.log('Whole sources ship skills with no catalog entry and no ADR-0014 exclusion:');
  for (const m of missing) console.log(`- \`${m.repo}\`: \`${m.path}\``);
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
