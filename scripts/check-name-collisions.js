#!/usr/bin/env node
// check-name-collisions — guard the seam `claude plugin validate` does not cover:
// a local plugin's command or skill whose name is already taken by something else
// this marketplace ships.
//
// `validate` checks that catalog entry `name` values are unique. It says nothing
// about a COMMAND inside one plugin against a SKILL inside another — and that gap
// shipped a real defect: `mode-router` owned `commands/handoff.md` while the
// catalog also carried an unrelated `handoff` skill. The harness resolved a typed
// `/handoff` to the other plugin's body, while the router's hook — which reads the
// raw prompt text, not the resolved command — recognised its own name and injected
// its own instructions onto that turn. Two documents, one turn, and every check in
// this repo green. See docs/adr/0004-rename-the-handoff-command.md.
//
// Only local artifacts are checked, because only they are ours to rename. What an
// upstream git-subdir entry contains is not knowable without fetching it; its
// catalog `name` is, and that is what local names are compared against.
//
// Usage: node scripts/check-name-collisions.js   (exit 1 on collision)

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// A skill's own `name` frontmatter wins over its directory, matching the harness.
// A command file has no `name` field at all: its name IS the filename.
function skillName(file, fallback) {
  const m = fs.readFileSync(file, 'utf8').match(/^name:\s*(\S+)\s*$/m);
  return m ? m[1] : fallback;
}

const ls = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
};

// Local catalog entries carry a repo-relative path as their `source`; that path is
// what ties an entry to the plugin directory whose artifacts it ships, and so what
// lets a plugin's own name be exempt from its own entry.
function collect() {
  const mk = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entries = (mk.plugins || []).map((p) => ({
    name: p.name,
    dir: typeof p.source === 'string' ? path.basename(p.source) : null,
  }));

  const artifacts = [];
  for (const plugin of ls(path.join(root, 'plugins')).filter((e) => e.isDirectory())) {
    const base = path.join(root, 'plugins', plugin.name);
    for (const f of ls(path.join(base, 'commands')).filter((e) => e.isFile() && e.name.endsWith('.md'))) {
      artifacts.push({
        leaf: path.basename(f.name, '.md'),
        kind: 'command',
        owner: plugin.name,
        file: path.relative(root, path.join(base, 'commands', f.name)),
      });
    }
    for (const d of ls(path.join(base, 'skills')).filter((e) => e.isDirectory())) {
      const file = path.join(base, 'skills', d.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      artifacts.push({
        leaf: skillName(file, d.name), kind: 'skill', owner: plugin.name,
        file: path.relative(root, file),
      });
    }
  }

  // Project skills share the bare namespace with everything above, so a name taken
  // here is taken for the whole repo. They belong to no plugin: `owner` is null,
  // which exempts them from nothing.
  for (const d of ls(path.join(root, '.claude', 'skills')).filter((e) => e.isDirectory())) {
    const file = path.join(root, '.claude', 'skills', d.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    artifacts.push({
      leaf: skillName(file, d.name), kind: 'project skill', owner: null,
      file: path.relative(root, file),
    });
  }

  return { entries, artifacts };
}

// Two collisions, one shape: a local name already spoken for. An artifact matching
// the catalog entry of the plugin that SHIPS it is the normal case
// (`mode-router`'s own skill is reached as `mode-router:mode-router`), so an entry
// is only a rival when it belongs to somebody else.
function findCollisions({ entries, artifacts }) {
  const found = [];
  for (const a of artifacts) {
    for (const e of entries) {
      if (e.name !== a.leaf) continue;
      if (a.owner && e.dir === a.owner) continue;
      found.push({ leaf: a.leaf, artifact: a, against: `catalog entry \`${e.name}\`` });
    }
  }
  for (let i = 0; i < artifacts.length; i++) {
    for (let j = i + 1; j < artifacts.length; j++) {
      const [a, b] = [artifacts[i], artifacts[j]];
      if (a.leaf !== b.leaf || (a.owner && a.owner === b.owner)) continue;
      found.push({ leaf: a.leaf, artifact: a, against: `${b.kind} in \`${b.file}\`` });
    }
  }
  return found;
}

module.exports = { findCollisions };

if (require.main === module) {
  const { entries, artifacts } = collect();
  const collisions = findCollisions({ entries, artifacts });

  if (collisions.length) {
    console.error(
      `${collisions.length} name collision${collisions.length === 1 ? '' : 's'} — ` +
        '`claude plugin validate` does not catch these:\n'
    );
    for (const c of collisions) {
      console.error(`  ${c.artifact.kind} \`${c.leaf}\` (${c.artifact.file})`);
      console.error(`    already taken by ${c.against}\n`);
    }
    console.error(
      'Rename the local one. A command and a skill sharing a name resolve to ONE\n' +
        'of them, while a hook reading the raw prompt text can still act as if it\n' +
        'were the other — see docs/adr/0004-rename-the-handoff-command.md.'
    );
    process.exit(1);
  }

  console.log(`No name collisions across ${artifacts.length} local artifacts and ${entries.length} catalog entries.`);
}
