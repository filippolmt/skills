// Self-check for check-whole-sources.js. Run: node scripts/check-whole-sources.test.js
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
| \`acme/plugin\` | whole | whole-plugin entry |
| \`acme/curated\` | curated | |

### Catalog exclusions

| Repo | Skill | Reason |
| --- | --- | --- |
| \`acme/whole\` | \`old\`, \`legacy\` | Superseded |
| \`acme/whole\` | \`extras/*\` | Not ours |
`;

const entry = (repo, p) => ({ name: p, source: { source: 'git-subdir', url: `https://github.com/${repo}`, path: p, sha: 'abc' } });

test('parseAdr reads both tables, including comma lists and globs', () => {
  const { sources, exclusions } = parseAdr(ADR);
  assert.deepEqual([...sources.keys()], ['acme/whole', 'acme/plugin', 'acme/curated']);
  assert.equal(sources.get('acme/plugin').notes, 'whole-plugin entry');
  assert.deepEqual(exclusions.get('acme/whole'), ['old', 'legacy', 'extras/*']);
});

test('uncatalogued reports only whole-source skills with no entry and no exclusion', () => {
  const { sources, exclusions } = parseAdr(ADR);
  const upstream = new Map([
    ['acme/whole', [
      'skills/kept', 'skills/new', 'skills/old', 'extras/x',
      'tests/fixture-skill', '.cursor/skills/kept', 'plugins/p/skills/kept',
    ]],
    ['acme/plugin', ['skills/anything']],
    ['acme/curated', ['skills/unpicked']],
  ]);
  const catalog = [entry('acme/whole', 'skills/kept')];
  assert.deepEqual(uncatalogued({ sources, exclusions, catalog, upstream }), [{ repo: 'acme/whole', path: 'skills/new' }]);
});

test('a single-skill source at the repo root counts its entry path "."', () => {
  const sources = new Map([['acme/one', { kind: 'whole', notes: 'single skill' }]]);
  const upstream = new Map([['acme/one', ['.']]]);
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
