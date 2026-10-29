#!/usr/bin/env node
// Read-only freshness audit, not an updater. Renovate owns routine pin bumps.
// Usage: node scripts/check-upstream-versions.js [owner/repo [candidate-tag]]
// Exit 0: current; 1: stale pins or tag-switch candidates; 2: incomplete/error.
const fs = require('fs');
const path = require('path');
const { readCatalog, isExternal, repoOf, entryPath, root } = require('./catalog.js');
const { githubApi } = require('./github.js');
const { releaseTagPattern, latestTags, tagNames } = require('./check-branch-pins.js');

const pattern = releaseTagPattern(JSON.parse(fs.readFileSync(path.join(root, 'renovate.json'), 'utf8')));

// Match folder names as well as catalog aliases; these are possible moves, not
// proof that a same-named skill has the same behavior.
function missingPaths(entries, tree) {
  const files = new Set(tree.filter((t) => t.type === 'blob').map((t) => t.path));
  const skills = [...files].filter((p) => p === 'SKILL.md' || p.endsWith('/SKILL.md'))
    .map((p) => path.posix.dirname(p));
  return entries.flatMap((e) => {
    const dir = entryPath(e);
    if (dir === '.') return [];
    if (files.has(`${dir}/SKILL.md`) || files.has(`${dir}/.claude-plugin/plugin.json`)) return [];
    const names = new Set([e.name, path.posix.basename(dir)]);
    return [{ name: e.name, path: dir,
      possibleLocations: skills.filter((p) => p !== dir && names.has(path.posix.basename(p))) }];
  });
}

// Public seam: offline callers supply API and tag readers; errors reject the
// entire audit so a partial report can never look like a successful check.
async function audit(catalog, { repo, tag, api = githubApi, tags = tagNames } = {}) {
  if (tag && (!repo || !pattern.test(tag))) throw new Error('A candidate needs owner/repo and a Renovate-compatible release tag');
  const entries = catalog.filter(isExternal).filter((e) => !repo || repoOf(e) === repo);
  if (repo && !entries.length) throw new Error(`No external entries for ${repo}`);
  const repos = [...new Set(entries.map(repoOf))];
  const lines = [];
  let attention = false;
  for (const source of repos) {
    const own = entries.filter((e) => repoOf(e) === source);
    const latest = latestTags(await tags(source), pattern);
    const cache = new Map();
    const resolve = async (ref) => {
      if (!cache.has(ref)) {
        const body = await api(`repos/${source}/commits/${encodeURIComponent(ref)}`);
        if (typeof body.sha !== 'string' || !body.sha) throw new Error(`${source}@${ref}: missing commit SHA`);
        cache.set(ref, body.sha);
      }
      return cache.get(ref);
    };
    const trees = new Map();
    const treeAt = async (sha) => {
      if (!trees.has(sha)) {
        const body = await api(`repos/${source}/git/trees/${sha}?recursive=1`);
        if (body.truncated !== false || !Array.isArray(body.tree)) {
          throw new Error(`${source}@${sha}: tree listing truncated or invalid; preflight incomplete`);
        }
        trees.set(sha, body.tree);
      }
      return trees.get(sha);
    };
    const preflight = async (candidate, sha, affected) => {
      const proposed = await treeAt(sha);
      const pinned = await treeAt(affected[0].source.sha);
      const missing = missingPaths(affected, proposed);
      const skillDirs = (tree) => tree.filter((item) => item.type === 'blob' &&
        (item.path === 'SKILL.md' || item.path.endsWith('/SKILL.md'))).map((item) => path.posix.dirname(item.path));
      const candidates = skillDirs(proposed);
      const removed = affected.flatMap((entry) => {
        const dir = entryPath(entry);
        return skillDirs(pinned).filter((skill) => (dir === '.' || skill === dir || skill.startsWith(`${dir}/`)) &&
          !candidates.includes(skill)).map((skill) => ({ name: entry.name, path: skill,
          possibleLocations: candidates.filter((next) => path.posix.basename(next) === path.posix.basename(skill)) }));
      });
      lines.push(`  Path preflight ${candidate} (${affected.length} entries): ${missing.length} absent skill/plugin paths; ${removed.length} removed/moved skills`);
      for (const [items, label] of [[missing, 'absent'], [removed, 'removed/moved']]) {
        for (const item of items) {
          lines.push(`    ${item.name}: ${label} ${item.path}; possible new locations (name match only): ` +
            (item.possibleLocations.join(', ') || 'none'));
        }
      }
    };
    // Entries can intentionally pin different series or digests; audit each pin.
    const pins = new Map();
    for (const e of own) {
      const key = JSON.stringify([e.source.ref, e.source.sha]);
      pins.set(key, [...(pins.get(key) || []), e]);
    }
    for (const affected of pins.values()) {
      const { ref, sha } = affected[0].source;
      const branch = ['main', 'master'].includes(ref);
      const groups = (ref.match(pattern) || {}).groups;
      if (!branch && !groups) throw new Error(`${source}: unsupported ref ${ref}`);
      const target = branch ? ref : latest.find((t) =>
        ((t.match(pattern) || {}).groups?.compatibility || '') === (groups.compatibility || ''));
      if (!target) throw new Error(`${source}: no release tag in the series of ${ref}`);
      const head = await resolve(target);
      const stale = ref !== target || sha !== head;
      attention ||= stale;
      lines.push(`${source} [${affected.map((e) => e.name).join(', ')}]: ${stale ? 'stale' : 'current'} — ` +
        `${ref}@${sha} -> ${branch ? 'branch HEAD' : 'latest same-series tag'} ${target}@${head}`);
      if (!branch && ref === target && sha !== head) lines.push('  Digest drift: pinned SHA differs from the tag commit');
      const candidates = tag ? [tag] : branch ? latest : [];
      for (const candidate of candidates) {
        const candidateSha = await resolve(candidate);
        const comparison = await api(`repos/${source}/compare/${encodeURIComponent(sha)}...${encodeURIComponent(candidateSha)}`);
        if (!['identical', 'ahead', 'behind', 'diverged'].includes(comparison.status)) {
          throw new Error(`${source}@${candidate}: invalid comparison status`);
        }
        const unsafe = ['behind', 'diverged'].includes(comparison.status);
        attention = true;
        lines.push(`  Tag candidate ${candidate}@${candidateSha}: ${comparison.status} relative to pinned ${sha}` +
          (unsafe ? ' — downgrade/history change; approval required after loss/move inventory' : ''));
        if (unsafe || tag) await preflight(candidate, candidateSha, affected);
      }
    }
  }
  return { lines, attention };
}

async function main(args = process.argv.slice(2)) {
  if (args.length > 2 || (args[0] && !/^[^/\s]+\/[^/\s]+$/.test(args[0]))) {
    throw new Error('Usage: node scripts/check-upstream-versions.js [owner/repo [candidate-tag]]');
  }
  const result = await audit(readCatalog().plugins, { repo: args[0], tag: args[1] });
  console.log(result.lines.join('\n') || 'No external entries.');
  if (result.attention) process.exitCode = 1;
}

if (require.main === module) main().catch((err) => {
  console.error(`Audit incomplete: ${err.message}`);
  process.exitCode = 2;
});
module.exports = { audit, missingPaths, main };
