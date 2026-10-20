#!/usr/bin/env node
// check-upstream-descriptions — find entries whose upstream description changed
// since a human last reviewed the catalog's text for them (ADR-0029).
//
// Renovate moves `ref` and `sha` and nothing else, so a description summarising
// upstream drifts with every bump: impeccable's said "23 commands" through four
// bumps after upstream said 24. Rewriting it is a judgement (`/add-external-skill
// update` rewrites only when the meaning changed), so this reports, it does not edit.
//
// The reviewed sha of an entry is the last one a non-Renovate commit set or
// rewrote it at, from the catalog's git history (so it needs a full clone), unless
// `descriptionReviewed` in scripts/catalog-meta.json acknowledges a later one —
// the record of a review that kept the text.
//
// Usage: node scripts/check-upstream-descriptions.js   (exit 1 when a description needs review)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readCatalog, isGitSubdir, repoOf, root } = require('./catalog.js');

const CATALOG = '.claude-plugin/marketplace.json';
const BOT = /\[bot\]$/;

// Pure: an entry's upstream description — a plugin manifest's `description`, else
// the SKILL.md frontmatter `description:` block raw, continuation lines included,
// so a folded description that changes only below its first line still differs.
function descriptionOf({ manifest, skill }) {
  if (manifest) return JSON.parse(manifest).description || null;
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill || '');
  const block = front && /^description:.*(?:\n[ \t]+.*)*/m.exec(front[1]);
  return block ? block[0] : null;
}

// Pure: entry name -> the upstream sha its description was last reviewed at.
// `history` is the catalog oldest first, each `{ bot, plugins }`.
function reviewedShas(history, acknowledged) {
  const reviewed = new Map();
  let previous = new Map();
  for (const { bot, plugins } of history) {
    const current = new Map(plugins.filter(isGitSubdir).map((e) => [e.name, e]));
    for (const [name, e] of current) {
      const before = previous.get(name);
      const touched = !before || before.source.sha !== e.source.sha || before.description !== e.description;
      if (touched && !bot) reviewed.set(name, e.source.sha);
    }
    previous = current;
  }
  for (const [name, sha] of Object.entries(acknowledged)) reviewed.set(name, sha);
  return reviewed;
}

// The report lines. `upstream(entry, sha)` resolves to the description or null
// when unreadable (a folder upstream deleted is regeneration's to prune).
async function findings(catalog, reviewed, upstream) {
  const lines = [];
  for (const e of catalog.filter(isGitSubdir)) {
    const base = reviewed.get(e.name);
    if (!base || base === e.source.sha) continue;
    const [before, after] = [await upstream(e, base), await upstream(e, e.source.sha)];
    if (before === null || after === null || before === after) continue;
    // The texts travel with the finding, so a review needs no second fetch.
    const text = (label, body) => `${label}:\n\n\`\`\`text\n${body}\n\`\`\`\n`;
    lines.push(`- \`${e.name}\` (\`${repoOf(e)}\`): upstream description changed between ` +
      `\`${base.slice(0, 7)}\` (reviewed) and \`${e.source.sha.slice(0, 7)}\` (pinned)\n\n` +
      `<details><summary>Texts</summary>\n\n` +
      text('Catalog', e.description) +
      text(`Upstream at \`${base.slice(0, 7)}\``, before) +
      text(`Upstream at \`${e.source.sha.slice(0, 7)}\``, after) +
      `\n</details>\n`);
  }
  return lines;
}

// raw.githubusercontent.com spends no API quota. Anything but 200 or 404 throws,
// so the caller exits 2 instead of reporting on half the catalog.
async function raw(repo, sha, file) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${repo}@${sha}/${file}: ${res.status}`);
  return res.text();
}

async function upstreamDescription(e, sha) {
  const dir = e.source.path === '.' ? '' : `${e.source.path.replace(/\/$/, '')}/`;
  const manifest = await raw(repoOf(e), sha, `${dir}.claude-plugin/plugin.json`);
  if (manifest) return descriptionOf({ manifest });
  const skill = await raw(repoOf(e), sha, `${dir}SKILL.md`);
  return skill ? descriptionOf({ skill }) : null;
}

function history() {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  return git('log', '--reverse', '--format=%H %an', '--', CATALOG).trim().split('\n').map((line) => {
    const [sha, ...author] = line.split(' ');
    return { bot: BOT.test(author.join(' ')), plugins: JSON.parse(git('show', `${sha}:${CATALOG}`)).plugins };
  });
}

async function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'catalog-meta.json'), 'utf8'));
  const lines = await findings(readCatalog().plugins, reviewedShas(history(), meta.descriptionReviewed || {}),
    upstreamDescription);
  if (!lines.length) return console.log('Every catalog description matches the upstream it was reviewed against.');
  console.log('Upstream descriptions changed since review:');
  for (const line of lines) console.log(line);
  console.log('\nReview each with `/add-external-skill update <owner/repo>`: rewrite the catalog ' +
    'description if the meaning changed, else record the pinned sha under the entry name in ' +
    '`descriptionReviewed` in scripts/catalog-meta.json.');
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 2;
  });
}

module.exports = { descriptionOf, reviewedShas, findings };
