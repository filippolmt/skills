// Self-check for gen-readme.js. Run: node scripts/gen-readme.test.js
// Exercises renderCatalog() + replaceBetweenMarkers() against fixtures — the pure render surface.
const { test } = require('node:test');
const assert = require('node:assert');
const { renderCatalog, table, replaceBetweenMarkers, START, END } = require('./gen-readme.js');

// Minimal fixture covering every branch: a skill group, a plugin group, an
// omitted local plugin, a shown local plugin, and two modes pulled out of their
// own repo grouping.
const MARKETPLACE = {
  plugins: [
    { name: 'mode-router', source: './plugins/mode-router', description: 'Routes stuff. And more.' },
    { name: 'the-bundle', source: './plugins/the-bundle', description: 'A bundle.' },
    { name: 'skill-a', source: { source: 'git-subdir', url: 'https://github.com/acme/skills', path: 'skills/a' }, description: 'Does A.' },
    { name: 'skill-b', source: { source: 'git-subdir', url: 'https://github.com/acme/skills', path: 'skills/b' }, description: 'Does B.' },
    { name: 'plug-x', source: { source: 'git-subdir', url: 'https://github.com/beta/agents', path: 'plugins/x' }, description: 'Bundles X.' },
    { name: 'caveman', source: { source: 'git-subdir', url: 'https://github.com/j/caveman', path: 'skills/caveman' }, description: 'Terse.' },
    { name: 'ponytail', source: { source: 'git-subdir', url: 'https://github.com/d/ponytail', path: 'skills/ponytail' }, description: 'Lazy.' },
  ],
};
const META = {
  groups: [
    { repo: 'acme/skills', tagline: 'stuff', kind: 'skill' },
    { repo: 'beta/agents', tagline: 'backend', kind: 'plugin' },
  ],
  omit: ['the-bundle'],
};
const MODES = ['caveman', 'ponytail'];

test('renders local line verbatim, omitting the omit list', () => {
  const md = renderCatalog(MARKETPLACE, META, MODES);
  assert.match(md, /\*\*Local:\*\* `mode-router` — Routes stuff\. And more\./);
  assert.doesNotMatch(md, /the-bundle/, 'omitted local plugin is not rendered');
});

test('skill group uses "What it does", plugin group uses "What it bundles"', () => {
  const md = renderCatalog(MARKETPLACE, META, MODES);
  assert.match(md, /### \[acme\/skills\]\(https:\/\/github\.com\/acme\/skills\) — stuff\n\n\| Skill \| What it does \|/);
  assert.match(md, /### \[beta\/agents\]\(https:\/\/github\.com\/beta\/agents\) — backend\n\n\| Plugin \| What it bundles \|/);
});

test('group rows follow marketplace order and use verbatim descriptions', () => {
  const md = renderCatalog(MARKETPLACE, META, MODES);
  assert.match(md, /\| `skill-a` \| Does A\. \|\n\| `skill-b` \| Does B\. \|/);
});

test('modes are pulled into their own table, not the repo groups', () => {
  const md = renderCatalog(MARKETPLACE, META, MODES);
  assert.match(md, /### Modes \(bundled by the local `mode-router` plugin\)/);
  assert.match(md, /\| `caveman` \| \[j\/caveman\]\(https:\/\/github\.com\/j\/caveman\) \| Terse\. \|/);
  // caveman/ponytail must NOT appear as their own ### repo group section
  assert.doesNotMatch(md, /### \[j\/caveman\]/);
});

test('throws on an unclassified git-subdir entry (drift guard)', () => {
  const drifted = { plugins: [...MARKETPLACE.plugins, { name: 'orphan', source: { source: 'git-subdir', url: 'https://github.com/new/repo', path: 'skills/o' }, description: 'Orphan.' }] };
  assert.throws(() => renderCatalog(drifted, META, MODES), /missing a group for: orphan \(new\/repo\)/);
});

test('table renders header, separator, then body rows', () => {
  assert.strictEqual(
    table(['A', 'B'], ['| 1 | 2 |', '| 3 | 4 |']),
    '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'
  );
});

test('replaceBetweenMarkers replaces only the region between markers', () => {
  const readme = `head\n${START}\nOLD\n${END}\ntail`;
  const out = replaceBetweenMarkers(readme, 'NEW');
  assert.strictEqual(out, `head\n${START}\nNEW\n${END}\ntail`);
});

test('replaceBetweenMarkers throws when markers are missing', () => {
  assert.throws(() => replaceBetweenMarkers('no markers here', 'x'), /missing the .* markers/);
});
