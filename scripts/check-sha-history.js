#!/usr/bin/env node
// check-sha-history — refuse a pinned `sha` moved onto another history (ADR-0041).
//
// `--verify-paths` lets a Renovate PR through when an entry's path is gone upstream,
// so regeneration can prune it (ADR-0015). That is right for an upstream that
// deleted a skill, whose new sha is AHEAD of the old one. A sha that is BEHIND or
// DIVERGED is a different event: a retired tag series that outranks the current one
// (ADR-0040), a force-push, a tag series restarted. Merged, it automerges and the
// next regeneration prunes a skill nobody removed. This fails such a PR instead,
// so a human decides.
//
// Usage: node scripts/check-sha-history.js <base-ref>
//   e.g. origin/main locally; FETCH_HEAD after fetching the PR base in CI.
// Exit 0: every moved sha is ahead or identical; 1: one is behind, diverged or
// unrelated (no merge base, or a sha that does not exist);
// 2: the base cannot be read or the GitHub API fails.

const { execFileSync } = require('child_process');
const { readCatalog, isExternal, repoOf } = require('./catalog.js');
const { githubApi } = require('./github.js');

// Pure: { moves, rehomed } for the external entries present on both sides.
// `moves`: [{ name, repo, from, to }] for a changed sha in the same repo. `rehomed`:
// [{ name, from, to }] for an entry now pinned in another repo, whose shas share no
// history to compare; Renovate never does this, so it is a human edit to check by
// hand. A new entry has no history to compare; a removed one is not moved.
function movedPins(base, head) {
  const before = new Map(base.filter(isExternal).map((e) => [e.name, e]));
  const moves = [];
  const rehomed = [];
  for (const e of head.filter(isExternal)) {
    const old = before.get(e.name);
    if (!old) continue;
    if (repoOf(old) !== repoOf(e)) rehomed.push({ name: e.name, from: repoOf(old), to: repoOf(e) });
    else if (old.source.sha !== e.source.sha) moves.push({ name: e.name, repo: repoOf(e), from: old.source.sha, to: e.source.sha });
  }
  return { moves, rehomed };
}

// GitHub's compare status for `from...to`. Compare answers 404 both when the two
// shas share no merge base (playwright-cli's 2020 tags against its current ones)
// and when a sha does not exist; either way there is no history from the pin, so
// both read `unrelated`. A missing sha also fails --verify-paths, which names it.
async function compareStatus(api, repo, from, to) {
  try {
    return (await api(`repos/${repo}/compare/${from}...${to}`)).status;
  } catch (err) {
    if (err.status === 404) return 'unrelated';
    throw err;
  }
}

// `compare` takes (repo, from, to) and resolves to GitHub's compare status. A repo
// pinning several entries to one move is compared once.
async function historyErrors(moves, compare) {
  const statuses = new Map();
  const errors = [];
  for (const m of moves) {
    const key = `${m.repo}@${m.from}...${m.to}`;
    if (!statuses.has(key)) statuses.set(key, await compare(m.repo, m.from, m.to));
    const status = statuses.get(key);
    if (!['ahead', 'identical'].includes(status)) {
      errors.push(`${m.name} (${m.repo}): ${m.from.slice(0, 7)} -> ${m.to.slice(0, 7)} is ${status}`);
    }
  }
  return errors;
}

module.exports = { movedPins, compareStatus, historyErrors };

if (require.main === module) {
  (async () => {
    const baseRef = process.argv[2];
    if (!baseRef || process.argv.length > 3) throw new Error('Usage: node scripts/check-sha-history.js <base-ref>');
    const baseText = execFileSync('git', ['show', `${baseRef}:.claude-plugin/marketplace.json`], { encoding: 'utf8' });
    const { moves, rehomed } = movedPins(JSON.parse(baseText).plugins, readCatalog().plugins);
    for (const r of rehomed) console.log(`Note: ${r.name} moved from ${r.from} to ${r.to}; no history to compare, check its path by hand.`);
    const errors = await historyErrors(moves, (repo, from, to) => compareStatus(githubApi, repo, from, to));
    if (errors.length) {
      console.error('Pinned shas moved off their history; the next regeneration would prune what\n' +
        'upstream never removed. Check the new ref before merging (ADR-0041):\n' +
        errors.map((e) => `  ${e}`).join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log(`${moves.length} moved ${moves.length === 1 ? 'sha is' : 'shas are'} ahead of the pin.`);
  })().catch((err) => {
    console.error(err.message);
    process.exitCode = 2;
  });
}
