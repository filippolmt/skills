#!/usr/bin/env node
// gen-skills-tree — vendor the catalog's skills into `skills/`.
//
// The tree is a PROJECTION of .claude-plugin/marketplace.json, in the same sense
// the README's catalog table is: derived, checked in CI, never hand-edited. It
// exists because pi cannot address a subdirectory of somebody else's repository,
// which is what all our git-subdir entries are — see ADR-0010 and ADR-0021.
//
// The tree lives at `skills/` because that is pi's package convention directory: a
// package is served from it with no manifest field naming it, which is why this repo
// needs no package.json. It also holds portable command/agent conversions and local
// plugin skills. Codex packages consume this same projection where possible; Claude
// installs references from the catalog.
//
// Two properties are deliberate:
//
//   - EVERY entry's `path` is resolved at its `sha`, and an unresolvable one is
//     PRUNED, never skipped: upstream deleted or renamed the folder, so the entry
//     leaves the catalog, its name leaves every bundle's `dependencies`, and the
//     regeneration PR carrying all of it names the removal. Skipping it would drop
//     a skill with nobody noticing — which is exactly how `sandbox-sdk` pointed at
//     a deleted folder for months while every check stayed green (ADR-0015).
//   - A native vendored skill is byte-identical to upstream before overlays.
//     Deterministic command/agent conversions carry explicit provenance; an
//     upstream that moves under an overlay still FAILS rather than freezing.
//
// Usage:
//   node scripts/gen-skills-tree.js                 # prune, then rewrite skills/ in place
//   node scripts/gen-skills-tree.js --verify-paths  # resolve every path, name what a
//                                                   # regeneration will prune, copy nothing
//   node scripts/gen-skills-tree.js --check         # exit 1 if the tree is out of date
//                                                   # or the catalog has something to prune
//
// The two checks are for different places, and the split is load-bearing. A Renovate
// PR moves a `sha`, so the tree it finds committed is out of date BY DESIGN until
// regeneration follows — running `--check` on pull requests would turn every one of
// those PRs red and force regeneration back into them, which is the coupling the ADR
// rejects. So CI runs `--verify-paths` on PRs and `--check` only where a stale tree
// is actionable: inside the regeneration job, as the signal that there is something
// to regenerate. For the same reason `--verify-paths` does not fail on an entry
// upstream removed: the Renovate PR moving its `sha` has to merge for regeneration
// to run at all, and regeneration is where the prune happens.
//
// The pure functions (parseFrontmatter, renderSource, vendorList, treeFingerprint,
// breakingBump, pruneManifest, formatLike) are exported for the test; the network
// and the file IO live in the CLI wrapper.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { readCatalog, isLocal, isGitSubdir, isBundle, repoOf, root, MARKETPLACE } = require('./catalog.js');
const { discoverArtifacts } = require('./distribution.js');
const { addProvenance, convertedSkillName, copySelfContained, validateSkillDirectories, writeConvertedSkill } = require('./portable-artifacts.js');

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

// Which entries need an upstream checkout: every git-subdir entry, always. Local
// plugin artifacts are projected in a second pass; bundles remain filter snippets,
// not skill directories.
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

// A comparable digest of a directory: every file's repo-relative path, mode and
// hash, sorted. What makes `--check` a comparison rather than a re-run. The mode is
// in there because `copyDir` deliberately preserves the execute bit — a skill
// shipping a script needs it — so a bit that drifts has to fail the comparison.
function treeFingerprint(dir) {
  if (!fs.existsSync(dir)) return '';
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else {
        const mode = (fs.statSync(abs).mode & 0o777).toString(8);
        out.push(`${r}\t${mode}\t${crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex')}`);
      }
    }
  };
  walk(dir, '');
  return out.join('\n');
}

// A breaking bump under CLAUDE.md's rule: below 1.0.0 it is a minor.
function breakingBump(version) {
  const [major, minor] = version.split('.').map(Number);
  return major < 1 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
}

// A local plugin's manifest with the pruned names out of its `dependencies` and a
// breaking bump, or null when it lists none of them. Throws on the two removals no
// script should settle: a non-bundle's dependencies are behaviour (`mode-router`'s
// hook routes to them), and a bundle losing the skill it is named after has no
// reason left to exist.
function pruneManifest(manifest, gone, bundle) {
  const deps = manifest.dependencies || [];
  const lost = deps.filter((d) => gone.includes(d));
  if (!lost.length) return null;
  if (!bundle) {
    throw new Error(`${manifest.name} depends on ${lost.join(', ')}, removed upstream — it is not a bundle, so dropping the dependency changes what it does: decide by hand`);
  }
  const primary = manifest.name.replace(/-bundle$/, '');
  if (lost.includes(primary)) {
    throw new Error(`${manifest.name} loses ${primary}, the skill it bundles for, removed upstream — remove or rework the bundle by hand`);
  }
  return { ...manifest, version: breakingBump(manifest.version), dependencies: deps.filter((d) => !lost.includes(d)) };
}

// `obj` as JSON in the layout of `original`: two-space indent, and an array the
// original kept on one line stays on one line. Without the second half a pruned
// manifest's diff is mostly whitespace around the one name that left.
function formatLike(original, obj) {
  let out = JSON.stringify(obj, null, 2) + '\n';
  for (const [, key] of original.matchAll(/"([^"]+)": \[[^\n\]]*\]/g)) {
    out = out.replace(new RegExp(`"${key}": \\[[^\\]]*\\]`), (m) =>
      m.replace(/\[\s+/, '[').replace(/\s+\]/, ']').replace(/,\s+/g, ', ')
    );
  }
  return out;
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

// Where an entry's `path` lands in its checkout, and whether anything is there.
function resolveEntry(entry, fetch = checkout) {
  const repo = repoOf(entry);
  const { url, sha, path: sub } = entry.source;
  if (!sha) throw new Error(`entry ${entry.name}: no sha to resolve — every git-subdir entry must pin one`);
  const repoDir = fetch(repo, url, sha);
  // `.` is a whole-plugin entry's path (ADR-0008), `./x` and `x` are the same
  // subdirectory — but a leading dot is not a prefix to strip: the real paths
  // include `.claude/skills/…`, which loses its meaning the moment it becomes
  // `claude/skills/…`.
  const rel = sub === '.' ? '' : String(sub || '').replace(/^\.\//, '').replace(/\/$/, '');
  const abs = rel ? path.join(repoDir, rel) : repoDir;
  return { repo, sha, repoDir, rel, abs, exists: fs.existsSync(abs) };
}

// The names of the entries whose `path` no longer exists at their `sha`: what a
// regeneration prunes. Checked for EVERY entry — this is the guard a deleted or
// renamed upstream folder walks into.
function unresolved(plugins, deps = {}) {
  const fetch = deps.checkout || checkout;
  return vendorList(plugins).filter((e) => !resolveEntry(e, fetch).exists).map((e) => e.name);
}

// Take the pruned entries out of the catalog and every local plugin's
// `dependencies`, then regenerate the README, whose two regions both derive from
// them. Every manifest is computed before anything is written, so a removal
// pruneManifest refuses leaves the working tree untouched. Returns the surviving
// plugins.
function prune(text, gone) {
  const doc = JSON.parse(text);
  doc.plugins = doc.plugins.filter((p) => !gone.includes(p.name));
  const writes = [[MARKETPLACE, formatLike(text, doc)]];
  for (const p of doc.plugins.filter(isLocal)) {
    const file = path.join(root, p.source, '.claude-plugin', 'plugin.json');
    const raw = fs.readFileSync(file, 'utf8');
    const pruned = pruneManifest(JSON.parse(raw), gone, isBundle(p));
    if (pruned) writes.push([file, formatLike(raw, pruned)]);
  }
  for (const [file, body] of writes) fs.writeFileSync(file, body);
  execFileSync('node', [path.join(root, 'scripts', 'gen-readme.js')], { stdio: 'inherit' });
  return doc.plugins;
}

// Resolve every entry and copy each one's skills into `dest`. A null `dest` resolves
// and copies nothing. Returns the vendored skill names; throws on the first thing
// that would silently lose a skill — an unresolved entry included, since the CLI
// prunes those before it builds. `deps` exists so the test can hand over a fake
// checkout and exercise those throws without a network.
function buildFromInventory(dest, plugins, inventory) {
  const catalog = new Map(plugins.map((entry) => [entry.name, entry]));
  const written = new Map();
  const claim = (name, owner) => {
    if (written.has(name)) throw new Error(`skill name '${name}' comes from both ${written.get(name)} and ${owner}`);
    written.set(name, owner);
  };

  for (const entry of inventory) {
    const plugin = catalog.get(entry.name);
    if (!plugin) throw new Error(`inventory entry has no catalog entry: ${entry.name}`);
    for (const artifact of entry.artifacts.filter((item) => ['skill', 'command', 'agent'].includes(item.kind))) {
      if (artifact.kind !== 'skill') {
        const name = convertedSkillName(entry, artifact);
        claim(name, entry.name);
        if (dest) writeConvertedSkill(entry, plugin, artifact, path.join(dest, name));
        continue;
      }

      const source = path.dirname(path.join(entry.sourceRoot, artifact.path));
      const name = parseFrontmatter(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).name;
      if (!name) throw new Error(`entry ${entry.name}: ${artifact.path} has no frontmatter name`);
      claim(name, entry.name);
      if (!dest) continue;
      const out = path.join(dest, name);
      if (isGitSubdir(plugin)) {
        const licence = licenceIn(entry.repoRoot);
        if (!licence) throw new Error(`entry ${entry.name}: ${repoOf(plugin)} ships no licence — no licence, no right to redistribute`);
        copyDir(source, out);
        const own = licenceIn(out);
        if (!own) fs.copyFileSync(path.join(entry.repoRoot, licence), path.join(out, licence));
        const patch = path.join(OVERLAYS, `${name}.patch`);
        const overlay = fs.existsSync(patch);
        if (overlay) git(out, 'apply', patch);
        fs.writeFileSync(path.join(out, 'SOURCE.md'), renderSource({
          entry: entry.name,
          repo: repoOf(plugin),
          sha: plugin.source.sha,
          dir: path.relative(entry.repoRoot, source) || '.',
          licence: own || licence,
          overlay: overlay ? `${name}.patch` : null,
        }));
      } else {
        copySelfContained(source, out);
        addProvenance(entry, plugin, out, path.join(plugin.source, artifact.path), 'Copied local Agent Skill into the pi package projection.');
      }
    }
  }
  return [...written.keys()].sort();
}

function build(dest, plugins, deps = {}) {
  const fetch = deps.checkout || checkout;
  const overlays = deps.overlays || OVERLAYS;
  const missing = [];
  const written = new Map();

  for (const entry of vendorList(plugins)) {
    const { repo, sha, repoDir, rel, abs, exists } = resolveEntry(entry, fetch);
    if (!exists) {
      missing.push(`  ${entry.name}: ${repo}@${sha.slice(0, 7)}:${rel || '.'} does not exist`);
      continue;
    }
    if (!dest) continue;

    const licence = licenceIn(repoDir);
    if (!licence) throw new Error(`entry ${entry.name}: ${repo} ships no licence — no licence, no right to redistribute`);

    const artifacts = discoverArtifacts(entry, abs);
    const portableEntry = { name: entry.name, sourceRoot: abs, repoRoot: repoDir };
    const skills = artifacts.filter((item) => item.kind === 'skill');
    for (const skill of skills) {
      const skillDir = path.dirname(path.join(abs, skill.path));
      const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
      const { name } = parseFrontmatter(md);
      if (!name) throw new Error(`entry ${entry.name}: ${path.relative(repoDir, skillDir)}/SKILL.md has no frontmatter name`);
      if (written.has(name)) {
        throw new Error(`skill name '${name}' comes from both ${written.get(name)} and ${entry.name} — pi keeps the first found and warns, so the tree must not contain two`);
      }
      written.set(name, entry.name);

      const out = path.join(dest, name);
      copyDir(skillDir, out);
      // A skill that ships its own licence keeps it: overwriting with the repo-root
      // one would break the byte-identity the whole design rests on.
      const own = licenceIn(out);
      if (!own) fs.copyFileSync(path.join(repoDir, licence), path.join(out, licence));

      // An overlay is a diff against the skill's own files, so it applies from
      // inside the vendored copy — `git apply` needs no repository for that.
      const patch = path.join(overlays, `${name}.patch`);
      const overlay = fs.existsSync(patch);
      if (overlay) git(out, 'apply', patch);

      const dirRel = path.relative(repoDir, skillDir) || '.';
      fs.writeFileSync(
        path.join(out, 'SOURCE.md'),
        renderSource({ entry: entry.name, repo, sha, dir: dirRel, licence: own || licence, overlay: overlay ? `${name}.patch` : null })
      );
    }

    for (const artifact of artifacts.filter((item) => ['command', 'agent'].includes(item.kind))) {
      const name = convertedSkillName(portableEntry, artifact);
      if (written.has(name)) throw new Error(`skill name '${name}' comes from both ${written.get(name)} and ${entry.name}`);
      written.set(name, entry.name);
      writeConvertedSkill(portableEntry, entry, artifact, path.join(dest, name));
    }
  }

  for (const entry of plugins.filter((item) => isLocal(item) && !isBundle(item))) {
    const sourceRoot = path.join(root, entry.source);
    const portableEntry = { name: entry.name, sourceRoot, repoRoot: root };
    for (const artifact of discoverArtifacts(entry, sourceRoot).filter((item) => ['skill', 'command', 'agent'].includes(item.kind))) {
      let name;
      if (artifact.kind === 'skill') {
        const source = path.dirname(path.join(sourceRoot, artifact.path));
        name = parseFrontmatter(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).name;
        if (!name) throw new Error(`entry ${entry.name}: ${artifact.path} has no frontmatter name`);
        if (written.has(name)) throw new Error(`skill name '${name}' comes from both ${written.get(name)} and ${entry.name}`);
        written.set(name, entry.name);
        if (dest) {
          const out = path.join(dest, name);
          copySelfContained(source, out);
          addProvenance(portableEntry, entry, out, path.join(entry.source, artifact.path), 'Copied local Agent Skill into the pi package projection.');
        }
      } else {
        name = convertedSkillName(portableEntry, artifact);
        if (written.has(name)) throw new Error(`skill name '${name}' comes from both ${written.get(name)} and ${entry.name}`);
        written.set(name, entry.name);
        if (dest) writeConvertedSkill(portableEntry, entry, artifact, path.join(dest, name));
      }
    }
  }

  if (missing.length) {
    throw new Error(`${missing.length} catalog entr${missing.length === 1 ? 'y' : 'ies'} will not resolve:\n${missing.join('\n')}`);
  }
  return [...written.keys()].sort();
}

module.exports = {
  parseFrontmatter,
  renderSource,
  vendorList,
  treeFingerprint,
  breakingBump,
  pruneManifest,
  formatLike,
  unresolved,
  build,
  buildFromInventory,
  checkout,
  resolveEntry,
};

// --- cli -------------------------------------------------------------------

if (require.main === module) {
  const check = process.argv.includes('--check');
  const { text, plugins: catalog } = readCatalog();
  const gone = unresolved(catalog);
  const goneList = gone.map((n) => `  ${n}`).join('\n');

  if (process.argv.includes('--verify-paths')) {
    const resolved = catalog.filter(isGitSubdir).length - gone.length;
    console.log(`${resolved} catalog paths resolve at their pinned sha.`);
    if (gone.length) console.log(`Removed upstream, pruned by the next regeneration:\n${goneList}`);
    // Artifact classification belongs to pull-request validation too: a path can
    // still resolve while a new command, agent, hook, or MCP capability appears.
    execFileSync('node', [path.join(root, 'scripts', 'gen-distribution.js'), '--verify'], { stdio: 'inherit' });
    process.exit(0);
  }
  if (check && gone.length) {
    console.error(`the catalog lists entries removed upstream:\n${goneList}\nRun: node scripts/gen-skills-tree.js`);
    process.exit(1);
  }

  const plugins = gone.length ? prune(text, gone) : catalog;
  if (gone.length) console.log(`pruned from the catalog, removed upstream:\n${goneList}`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-tree-out-'));

  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'distribution-meta.json'), 'utf8'));
    const { generate } = require('./gen-distribution.js');
    const { inventory } = generate(plugins, metadata);
    const names = buildFromInventory(staging, plugins, inventory);
    validateSkillDirectories(staging);

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

