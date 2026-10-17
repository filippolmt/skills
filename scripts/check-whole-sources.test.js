// Self-check for check-whole-sources.js. Run: node scripts/check-whole-sources.test.js
//
// The network half is thin; what can go wrong silently is the classification, so
// that runs here against a fake ADR and fake upstream trees.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseAdr, uncatalogued } = require('./check-whole-sources.js');

const ADR = `
### Source repos

| Repo | Kind | Notes |
| --- | --- | --- |
| \`acme/whole\` | whole | |
| \`acme/plugin\` | whole | prose here is not read |
| \`acme/mixed\` | whole | |
| \`acme/empty\` | whole | |
| \`acme/curated\` | curated | |

### Catalog exclusions

| Repo | Skill | Reason |
| --- | --- | --- |
| \`acme/whole\` | \`old\`, \`legacy\` | Superseded |
| \`acme/whole\` | \`extras/*\` | Not ours |
`;

const entry = (repo, p) => ({ name: p, source: { source: 'git-subdir', url: `https://github.com/${repo}`, path: p, sha: 'abc' } });
const tree = (skills, plugins = []) => ({ skills, plugins: new Set(plugins) });

test('parseAdr reads both tables, including comma lists and globs', () => {
  const { sources, exclusions } = parseAdr(ADR);
  assert.deepEqual([...sources.keys()], ['acme/whole', 'acme/plugin', 'acme/mixed', 'acme/empty', 'acme/curated']);
  assert.equal(sources.get('acme/curated').kind, 'curated');
  assert.deepEqual(exclusions.get('acme/whole'), ['old', 'legacy', 'extras/*']);
});

test('parseAdr refuses a source listed twice', () => {
  assert.throws(() => parseAdr(ADR.replace('| `acme/curated` | curated | |', '| `acme/whole` | curated | |')), /twice/);
});

test('uncatalogued reports only whole-source skills with no entry and no exclusion', () => {
  const { sources, exclusions } = parseAdr(ADR);
  const upstream = new Map([
    ['acme/whole', tree([
      'skills/kept', 'skills/new', 'skills/old', 'extras/x', 'test/real-skill',
      'tests/fixture-skill', '.cursor/skills/kept', 'plugins/p/skills/kept',
    ])],
    // Every entry is a plugin root upstream: the unit is the plugin, mirrors and all.
    ['acme/plugin', tree(['skills/anything', '.gemini/skills/anything'], ['.'])],
    // One plugin-root entry beside a per-skill one: only the plugin's insides are covered.
    ['acme/mixed', tree(['plug/skills/a', 'skills/b', 'skills/c'], ['plug'])],
    ['acme/empty', tree([])],
    ['acme/curated', tree(['skills/unpicked'])],
  ]);
  const catalog = [
    entry('acme/whole', 'skills/kept'),
    entry('acme/plugin', '.'),
    entry('acme/mixed', 'plug'),
    entry('acme/mixed', 'skills/b'),
  ];
  assert.deepEqual(uncatalogued({ sources, exclusions, catalog, upstream }), [
    { repo: 'acme/whole', path: 'skills/new' },
    { repo: 'acme/whole', path: 'test/real-skill' },
    { repo: 'acme/mixed', path: 'skills/c' },
    { repo: 'acme/empty', path: null },
  ]);
});

test('a single-skill source at the repo root counts its entry path "."', () => {
  const sources = new Map([['acme/one', { kind: 'whole' }]]);
  const upstream = new Map([['acme/one', tree(['.'])]]);
  const catalog = [entry('acme/one', '.')];
  assert.deepEqual(uncatalogued({ sources, exclusions: new Map(), catalog, upstream }), []);
});

test('the real ADR parses into the tables the check depends on', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'docs', 'adr', '0014-each-source-repo-is-whole-or-curated.md'), 'utf8');
  const { sources, exclusions } = parseAdr(text);
  assert.equal(sources.get('cloudflare/skills').kind, 'whole');
  for (const [repo, { kind }] of sources) assert.match(kind, /^(whole|curated)$/, `${repo} has kind ${kind}`);
  assert.ok(exclusions.get('mvanhorn/cli-printing-press').includes('printing-press-retro'));
});
