#!/usr/bin/env node
// check-branch-pins — find entries pinned to `main`/`master` whose repo now
// publishes release tags (ADR-0026).
//
// An entry is pinned to a tag whenever upstream publishes semver tags; a branch
// pin is for repos that publish none. Nothing noticed when such a repo started
// tagging: Renovate kept moving the branch `sha`, and `Leonxlnx/taste-skill` sat on
// `main` for six days after its first release. This reports the switch; making it
// stays a human edit through `/add-external-skill update`.
//
// A tag behind the pinned `sha` is listed as a note, not a finding: switching to
// it downgrades, and the next release will be ahead of the pin.
//
// Usage: node scripts/check-branch-pins.js   (exit 1 when a pin should move to a tag)
// Set GITHUB_TOKEN to lift the anonymous GitHub API rate limit.

const fs = require('fs');
const path = require('path');
const { readCatalog, isExternal, repoOf, root } = require('./catalog.js');
const { githubApi } = require('./github.js');

// Pure: the tag shape renovate.json's tag manager accepts, read from its
// versioningTemplate so the two cannot drift (a tag it rejects is never updated).
function releaseTagPattern(renovate) {
  const manager = renovate.customManagers.find((m) => m.datasourceTemplate === 'github-tags');
  return new RegExp(manager.versioningTemplate.replace(/^regex:/, ''));
}

// Pure: repo -> the shas its branch-pinned entries hold (normally one).
function branchPins(catalog) {
  const pins = new Map();
  for (const e of catalog.filter(isExternal)) {
    if (!['main', 'master'].includes(e.source.ref)) continue;
    const repo = repoOf(e);
    pins.set(repo, [...new Set([...(pins.get(repo) || []), e.source.sha])]);
  }
  return pins;
}

// Pure: the highest release tag of each series (its `compatibility` prefix).
function latestTags(names, pattern) {
  const best = new Map();
  for (const name of names) {
    const g = (name.match(pattern) || {}).groups;
    if (!g) continue;
    const version = [g.major, g.minor, g.patch].map(Number);
    const series = g.compatibility || '';
    const current = best.get(series);
    // The first component that differs decides.
    const i = current ? version.findIndex((v, k) => v !== current.version[k]) : 0;
    if (!current || (i >= 0 && version[i] > current.version[i])) best.set(series, { name, version });
  }
  return [...best.values()].map((t) => t.name);
}

// Pure: the report line for one pin and tag, from GitHub's compare of
// `<pinned sha>...<tag>`. A finding asks for the switch; a note does not.
function describe(repo, sha, tag, { status, ahead_by: ahead, behind_by: behind }) {
  const at = `\`${repo}\`: pinned at \`${sha.slice(0, 7)}\`, \`${tag}\``;
  if (status === 'identical') return { finding: true, line: `- ${at} is the same commit — switch to it` };
  if (status === 'ahead') return { finding: true, line: `- ${at} is ${ahead} commits ahead — switch to it` };
  if (status === 'diverged') return { finding: true, line: `- ${at} is on a diverged history — decide before switching` };
  return { finding: false, line: `- ${at} is ${behind} commits behind — switching would downgrade` };
}

async function tagNames(repo) {
  const names = [];
  for (let page = 1; ; page++) {
    const batch = await githubApi(`repos/${repo}/tags?per_page=100&page=${page}`);
    names.push(...batch.map((t) => t.name));
    if (batch.length < 100) return names;
  }
}

async function main() {
  const pattern = releaseTagPattern(JSON.parse(fs.readFileSync(path.join(root, 'renovate.json'), 'utf8')));
  const findings = [];
  const notes = [];
  for (const [repo, shas] of branchPins(readCatalog().plugins)) {
    for (const tag of latestTags(await tagNames(repo), pattern)) {
      for (const sha of shas) {
        const { finding, line } = describe(repo, sha, tag, await githubApi(`repos/${repo}/compare/${sha}...${tag}`));
        (finding ? findings : notes).push(line);
      }
    }
  }
  console.log(findings.length
    ? 'Branch-pinned repos publish release tags:'
    : 'No branch-pinned repo publishes a release tag at or past its pin.');
  for (const f of findings) console.log(f);
  if (findings.length) console.log('\nSwitch them with `/add-external-skill update <owner/repo>`.');
  if (notes.length) console.log(`\nTags behind their pin, not reported:\n${notes.join('\n')}`);
  if (findings.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 2;
  });
}

module.exports = { releaseTagPattern, branchPins, latestTags, describe, tagNames };
