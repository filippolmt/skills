// Self-check of scripts/catalog-meta.json's layout. Run: node --test scripts/catalog-meta.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// A JSON tool (`jq`, JSON.stringify) rewriting the file spreads every group over five
// lines; one line per group keeps a new source a one-line diff.
test('catalog-meta.json keeps one line per group', () => {
  const text = fs.readFileSync(path.join(__dirname, 'catalog-meta.json'), 'utf8');
  const { groups } = JSON.parse(text);
  const lines = text.split('\n').filter((l) => /^ {4}\{ "repo": ".+" \},?$/.test(l));
  assert.strictEqual(lines.length, groups.length,
    'every group in scripts/catalog-meta.json sits on its own line; insert new ones as text, not through a JSON rewrite');
});
