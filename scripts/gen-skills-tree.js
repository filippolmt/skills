#!/usr/bin/env node
// gen-skills-tree — vendor the catalog's skills into `skills/`.
//
// The tree is a PROJECTION of .claude-plugin/marketplace.json, in the same sense
// the README's catalog table is: derived, checked in CI, never hand-edited. It
// exists because neither pi nor Codex can address a subdirectory of somebody
// else's repository, which is what all our git-subdir entries are — see
// docs/adr/0010-vendor-a-shared-skills-tree-on-main.md.
//
// The tree lives at `skills/` because that one position serves all three harnesses:
// it is a Claude plugin's mandatory `<plugin-root>/skills/` (this repo is itself a
// plugin), pi's package convention directory, and a Codex plugin's default skill
// root. `.agents/skills` — the Agent Skills standard's shared path, which pi and
// Codex scan with nothing installed — is a committed SYMLINK to it, so there is
// still exactly one copy.
//
// Two properties are deliberate:
//
//   - EVERY entry's `path` is resolved at its `sha`, even the ones not vendored,
//     and an unresolvable one fails the whole run. Skipping it would drop a skill
//     with nobody noticing — which is exactly how `sandbox-sdk` pointed at a
//     deleted folder for months while every check stayed green.
//   - A vendored copy is byte-identical to upstream. Adaptation belongs in
//     overlays/<skill>.patch, applied with `git apply` afterwards, so an upstream
//     that moves under a patch FAILS instead of silently freezing the skill.
//
// Usage:
//   node scripts/gen-skills-tree.js          # rewrite skills/ in place
//   node scripts/gen-skills-tree.js --check  # exit 1 if the tree is out of date
//
// The pure functions (parseFrontmatter, renderSource, vendorList, treeFingerprint)
// are exported for the test; the network and the file IO live in the CLI wrapper.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { readCatalog, isGitSubdir, repoOf, root } = require('./catalog.js');

const TREE = path.join(root, 'skills');
const OVERLAYS = path.join(root, 'overlays');

// A licence is the right to redistribute. No licence, no copy — so the name is
// looked up rather than assumed, and its absence is fatal.
const LICENCE_RE = /^(LICEN[SC]E|COPYING)(\..*)?$/i;

// --- pure ------------------------------------------------------------------

// The `name` and `description` of a SKILL.md, from its YAML frontmatter. Both
// agents require both fields, so a skill missing either is not a skill we can
// vendor. Deliberately not a YAML parser: the two lines we need are flat.
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const field = (k) => {
    const f = new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(m[1]);
    if (!f) return undefined;
    const v = f[1].trim().replace(/^['"]|['"]$/g, '');
    return v === '>' || v === '|' ? undefined : v;
  };
  return { name: field('name'), description: field('description') };
}

// Which entries get copied: every git-subdir entry, always. Adding one to the
// catalog is what puts its skill in the tree — there is no second list to keep in
// step. Bundles and local plugins never appear: they have no upstream to vendor,
// and neither agent has a `dependencies` field for a bundle to be.
function vendorList(plugins) {
  return plugins.filter(isGitSubdir);
}

// What lands beside every vendored copy: where it came from and under what
// licence. Written as prose rather than JSON because its reader is a human
// wondering why a directory they did not write is in their repo.
function renderSource({ entry, repo, sha, dir, licence, overlay }) {
  const lines = [
    '# Source',
    '',
    'Vendored copy — **do not edit**. Regenerate with `node scripts/gen-skills-tree.js`.',
    '',
    `- **Upstream**: https://github.com/${repo}/tree/${sha}/${dir}`,
    `- **Commit**: \`${sha}\``,
    `- **Licence**: \`${licence}\`, copied beside this file`,
    `- **Catalog entry**: \`${entry}\` in \`.claude-plugin/marketplace.json\``,
  ];
  if (overlay) lines.push(`- **Overlay applied**: \`overlays/${overlay}\``);
  lines.push('');
  return lines.join('\n');
}

// A comparable digest of a directory: every file's repo-relative path and hash,
// sorted. What makes `--check` a comparison rather than a re-run.
function treeFingerprint(dir) {
  if (!fs.existsSync(dir)) return '';
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else out.push(`${r}\t${crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex')}`);
    }
  };
  walk(dir, '');
  return out.join('\n');
}

// --- impure ----------------------------------------------------------------

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

// One shallow checkout per (repo, sha), cached in the temp dir so a re-run and a
// `--check` in the same job do not clone twice. `--depth 1` of a bare sha is
// enough: we only ever read files at that commit.
function checkout(repo, url, sha) {
  const dir = path.join(os.tmpdir(), 'skills-tree', `${repo.replace(/\//g, '__')}@${sha.slice(0, 12)}`);
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', url);
  git(dir, 'fetch', '-q', '--depth', '1', 'origin', sha);
  git(dir, 'checkout', '-q', 'FETCH_HEAD');
  return dir;
}

const licenceIn = (dir) => fs.readdirSync(dir).find((f) => LICENCE_RE.test(f));

// Copy a directory, explicitly. `fs.cpSync` inherits the source's directory
// modes and ownership, which is one more thing that can differ between a
// developer's machine and a CI runner — and a generated tree that differs by
// mode fails `--check` for no reason a reader could see. Directories are made
// fresh at 0o755; a file keeps its own mode, because a skill that ships a script
// needs its execute bit. `.git` never travels: a whole-plugin entry's path is
// the repo root.
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true, mode: 0o755 });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else if (e.isDirectory()) copyDir(from, to);
    else if (e.isFile()) {
      fs.writeFileSync(to, fs.readFileSync(from));
      fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    }
  }
}

// Every SKILL.md at or under `start`, as the directories holding them. An entry
// is usually one skill, but not always: `shell-scripting` is one entry over
// three, and a whole-plugin entry's path is the repo root.
function skillDirs(start) {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name === 'SKILL.md') found.push(d);
    }
  };
  walk(start);
  return found.sort();
}

// Resolve every entry, copy the ones on the list. Returns the vendored skill
// names; throws on the first thing that would silently lose a skill.
function build(dest, plugins) {
  const wanted = new Set(vendorList(plugins).map((e) => e.name));
  const unresolved = [];
  const written = new Map();

  for (const entry of plugins.filter(isGitSubdir)) {
    const repo = repoOf(entry);
    const { url, sha, path: sub } = entry.source;
    if (!sha) throw new Error(`entry ${entry.name}: no sha to resolve — every git-subdir entry must pin one`);
    const repoDir = checkout(repo, url, sha);
    // `.` is a whole-plugin entry's path (ADR-0008), `./x` and `x` are the same
    // subdirectory — but a leading dot is not a prefix to strip: the real paths
    // include `.claude/skills/…`, which loses its meaning the moment it becomes
    // `claude/skills/…`.
    const rel = sub === '.' ? '' : String(sub || '').replace(/^\.\//, '').replace(/\/$/, '');
    const abs = rel ? path.join(repoDir, rel) : repoDir;

    // Resolution is checked for EVERY entry, vendored or not: this is the guard
    // a renamed upstream folder walks into.
    if (!fs.existsSync(abs)) {
      unresolved.push(`  ${entry.name}: ${repo}@${sha.slice(0, 7)}:${rel || '.'} does not exist`);
      continue;
    }
    if (!wanted.has(entry.name)) continue;

    const licence = licenceIn(repoDir);
    if (!licence) throw new Error(`entry ${entry.name}: ${repo} ships no licence — no licence, no right to redistribute`);

    for (const skillDir of skillDirs(abs)) {
      const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
      const { name } = parseFrontmatter(md);
      if (!name) throw new Error(`entry ${entry.name}: ${path.relative(repoDir, skillDir)}/SKILL.md has no frontmatter name`);
      if (written.has(name)) {
        throw new Error(`skill name '${name}' comes from both ${written.get(name)} and ${entry.name} — pi keeps the first found and warns, so the tree must not contain two`);
      }
      written.set(name, entry.name);

      const out = path.join(dest, name);
      copyDir(skillDir, out);
      fs.copyFileSync(path.join(repoDir, licence), path.join(out, licence));

      // An overlay is a diff against the skill's own files, so it applies from
      // inside the vendored copy — `git apply` needs no repository for that.
      const patch = path.join(OVERLAYS, `${name}.patch`);
      const overlay = fs.existsSync(patch);
      if (overlay) git(out, 'apply', patch);

      const dirRel = path.relative(repoDir, skillDir) || '.';
      fs.writeFileSync(
        path.join(out, 'SOURCE.md'),
        renderSource({ entry: entry.name, repo, sha, dir: dirRel, licence, overlay: overlay ? `${name}.patch` : null })
      );
    }
  }

  if (unresolved.length) {
    throw new Error(`${unresolved.length} catalog entr${unresolved.length === 1 ? 'y' : 'ies'} will not resolve:\n${unresolved.join('\n')}`);
  }
  return [...written.keys()].sort();
}

// --- cli -------------------------------------------------------------------

if (require.main === module) {
  const check = process.argv.includes('--check');
  const { plugins } = readCatalog();
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-tree-out-'));

  try {
    const names = build(staging, plugins);

    if (check) {
      if (treeFingerprint(staging) === treeFingerprint(TREE)) {
        console.log(`skills/ is in sync (${names.length} skills).`);
        process.exit(0);
      }
      console.error('skills/ is out of date. Run: node scripts/gen-skills-tree.js');
      process.exit(1);
    }

    // Only the real directory is rebuilt. `.agents/skills` is a symlink to it and
    // survives untouched — it points at the path, not at the inode.
    fs.rmSync(TREE, { recursive: true, force: true });
    copyDir(staging, TREE);
    console.log(`skills/ regenerated (${names.length} skills): ${names.join(', ')}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { parseFrontmatter, renderSource, vendorList, treeFingerprint };
