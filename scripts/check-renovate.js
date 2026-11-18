#!/usr/bin/env node
// check-renovate — guard the implicit seam between renovate.json's customManager
// regex and the external entry shape in marketplace.json.
//
// Renovate bumps each pinned `sha` by matching entries with a regex in
// renovate.json. If the entry shape changes and the regex is not updated in
// lockstep, matching silently drops to zero and auto-updates stop with no error.
// This asserts the regex matches EXACTLY the external entries — run in CI. It also
// rejects the two entry shapes that do not install what they say: a git-subdir
// `path` at the repo root, and a url entry carrying a `path`; and a packageRule
// naming a package no entry pins, which Renovate drops silently (ADR-0040). And
// it rejects a harness CLI a workflow installs with `npm install -g` that is
// unpinned, or that no customManager (or more than one) bumps (ADR-0047).
//
// Usage: node scripts/check-renovate.js   (exit 1 on mismatch)

const fs = require('fs');
const path = require('path');
const { readCatalog, isGitSubdir, isUrl, isExternal, isRepoRoot, repoOf, root } = require('./catalog.js');

// Pure: the message this guard exists to print, or null when the regexes cover the
// catalog exactly. Split from the file reading because the guard's own failure mode
// is SILENCE — a broken regex matches nothing, and a guard broken the same way
// reports nothing — so running it only against a tree that happens to pass is not a
// check. Taking the catalog and the parsed renovate.json as arguments is what lets
// check-renovate.test.js hand it a tree that FAILS.
//
// `catalog` is `{ text, plugins }` from readCatalog(): the regexes are matched
// against the file as written, because that is what Renovate itself matches.
const externalCount = (catalog) => catalog.plugins.filter(isExternal).length;
const entries = (n) => `entr${n === 1 ? 'y' : 'ies'}`;

function coverageError(catalog, renovate) {
  const expected = externalCount(catalog);

  // EVERY customManager counts, not just the first: the entry shape is split
  // across two of them by `ref` (a branch -> git-refs, a tag -> github-tags), and
  // they are only a guard TOGETHER. Reading one alone reports the other's entries
  // as uncovered — which is exactly what this check is supposed to detect, so the
  // false alarm is indistinguishable from the real fault.
  const managers = (renovate.customManagers || []).filter((m) => Array.isArray(m.matchStrings));
  if (!managers.length) return 'renovate.json: no customManager with matchStrings found';

  // Track WHERE each match starts, not just how many there are: an entry claimed by
  // two managers and an entry claimed by none cancel out in a plain count, and the
  // uncovered entry is the failure mode this guard exists for.
  const offsets = [];
  for (const manager of managers) {
    for (const pattern of manager.matchStrings) {
      const re = new RegExp(pattern, 'g');
      for (const m of catalog.text.matchAll(re)) offsets.push(m.index);
    }
  }

  const matched = new Set(offsets).size;
  if (matched !== offsets.length) {
    const over = offsets.length - matched;
    return `${over} marketplace entr${over === 1 ? 'y is' : 'ies are'} ` +
      'matched by more than one customManager in renovate.json — two managers would ' +
      'fight over the same sha. Narrow the regexes so each entry has exactly one.';
  }

  if (matched !== expected) {
    return `Renovate regex matches ${matched} ${entries(matched)} but ` +
      `marketplace.json has ${expected} external ${entries(expected)}.\n` +
      'The customManager matchStrings in renovate.json is out of sync with the ' +
      'entry shape — sha auto-bumps will silently stop. Fix the regex.';
  }

  return null;
}

// Pure: the message naming every entry whose shape misstates what Claude Code
// installs, or null. A git-subdir `path` at the repo root is sparse-checked-out
// in cone mode, so only the top-level files land: no skills, agents or hooks, and
// `claude plugin validate` passes it. A url entry is cloned whole, so a `path` on
// it is ignored and only misleads the next author
// (docs/adr/0033-a-repo-root-plugin-is-a-url-entry.md).
function entryShapeError(plugins) {
  const rooted = plugins.filter((e) => isGitSubdir(e) && isRepoRoot(e.source.path)).map((e) => e.name);
  const pathed = plugins.filter((e) => isUrl(e) && e.source.path !== undefined).map((e) => e.name);
  const errors = [];
  if (rooted.length) {
    errors.push(`git-subdir ${entries(rooted.length)} rooted at the repo root: ${rooted.join(', ')}.\n` +
      'Claude Code installs only the top-level files of such an entry. Use ' +
      '{ "source": "url", "url", "ref", "sha" } with no `path` instead (ADR-0033).');
  }
  if (pathed.length) {
    errors.push(`url ${entries(pathed.length)} with a \`path\`: ${pathed.join(', ')}.\n` +
      'Claude Code ignores `path` on a url source and installs the whole repo. Drop ' +
      'it, or use git-subdir for a subfolder (ADR-0033).');
  }
  return errors.length ? errors.join('\n') : null;
}

// Pure: the message naming every packageRule package that no external entry pins,
// or null. A source renamed in marketplace.json leaves its rule matching nothing,
// and Renovate then drops the rule without a word (ADR-0040). Both package-name
// forms count: `owner/repo` (github-tags) and the repo URL (git-refs).
function orphanRuleError(catalog, renovate) {
  const repos = new Set(catalog.plugins.filter(isExternal).map(repoOf).filter(Boolean)
    .flatMap((r) => [r, `https://github.com/${r}`]));
  const orphans = (renovate.packageRules || []).flatMap((r) => r.matchPackageNames || []).filter((n) => !repos.has(n));
  return orphans.length
    ? `renovate.json: packageRules name ${orphans.join(', ')}, which no external entry pins. ` +
      'Renovate ignores such a rule silently: update matchPackageNames together with the entry.'
    : null;
}

// npm's aliases for `install`: a global install under any of them is still one.
const NPM_INSTALL = new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall']);
const SHELL_SEPARATOR = new Set(['&&', '||', ';', '|']);

// Every package spec a global `npm install` names in `text`, with its offset. Reads
// shell as words split on whitespace: a spec quoted or built from a variable reads
// as written, and is then reported unpinned rather than skipped.
function globalInstalls(text) {
  // A `\` continuation becomes two spaces, so offsets still point into `text`.
  const flat = text.replace(/\\\n/g, '  ');
  const installs = [];
  let lineStart = 0;
  for (const line of flat.split('\n')) {
    let command = [];
    const commands = [command];
    for (const m of line.matchAll(/\S+/g)) {
      if (m[0].startsWith('#')) break;
      if (SHELL_SEPARATOR.has(m[0])) { commands.push(command = []); continue; }
      const word = m[0].replace(/;$/, '');
      command.push({ word, at: lineStart + m.index });
      if (word !== m[0]) commands.push(command = []);
    }
    for (const words of commands) {
      const npm = words.findIndex((w) => w.word === 'npm');
      if (npm < 0 || !NPM_INSTALL.has(words[npm + 1]?.word)) continue;
      const args = words.slice(npm + 2);
      let global = false;
      const specs = [];
      for (let i = 0; i < args.length; i++) {
        const { word, at } = args[i];
        if (word === '-g' || word === '--global' || word === '--location=global') global = true;
        else if (word === '--location') global ||= args[++i]?.word === 'global';
        else if (!word.startsWith('-')) {
          const quoted = /^(['"])(.*)\1$/.exec(word);
          specs.push(quoted ? { spec: quoted[2], at: at + 1 } : { spec: word, at });
        }
      }
      if (global) installs.push(...specs);
    }
    lineStart += line.length + 1;
  }
  return installs;
}

// The `<depName>@<currentValue>` pins Renovate's own regexes extract from `file`,
// each with the span of text it matched: what the installs are checked against,
// independently of how globalInstalls reads them.
function claimedPins(file, text, renovate) {
  const claims = [];
  const errors = [];
  for (const manager of renovate.customManagers || []) {
    const reaches = (manager.managerFilePatterns || []).some((pattern) => {
      const regex = /^\/(.*)\/$/.exec(pattern);
      if (!regex) errors.push(`renovate.json: managerFilePatterns ${pattern} is not a /regex/; this check reads only that form.`);
      return regex && new RegExp(regex[1]).test(file);
    });
    if (!reaches) continue;
    for (const pattern of manager.matchStrings || []) {
      for (const m of text.matchAll(new RegExp(pattern, 'g'))) {
        if (m.groups?.depName && m.groups?.currentValue) {
          claims.push({ spec: `${m.groups.depName}@${m.groups.currentValue}`, from: m.index, to: m.index + m[0].length });
        }
      }
    }
  }
  return { claims, errors };
}

// Pure: the message naming every harness CLI a workflow installs globally that is
// unpinned, or pinned but bumped by no customManager or by several, or null. CI
// tests the projections with pi, Codex and Claude Code; a floating install runs
// whatever is latest that minute, unrecorded, and a pin no manager reaches stays
// at its version without a word (ADR-0047).
// `workflows` is `[{ file, text }]`, `file` relative to the repo root.
function cliPinError(workflows, renovate) {
  const errors = [];
  for (const { file, text } of workflows) {
    const { claims, errors: patternErrors } = claimedPins(file, text, renovate);
    errors.push(...patternErrors);
    // Claims are matched to installs by WHERE they are, not counted: an install
    // claimed twice and one claimed by none cancel out in a plain count.
    for (const { spec, at } of globalInstalls(text)) {
      const owners = claims.filter((c) => c.spec === spec && c.from <= at && at + spec.length <= c.to).length;
      if (!/^(?:@[^/@\s]+\/)?[^@\s]+@\d+\.\d+\.\d+$/.test(spec)) {
        errors.push(`${file}: ${spec} is unpinned; pin an exact version for Renovate to bump.`);
      } else if (owners === 0) {
        errors.push(`${file}: ${spec} is claimed by no Renovate customManager; it will stay at this version. Fix the manager's file pattern or regex.`);
      } else if (owners > 1) {
        errors.push(`${file}: ${spec} is claimed by more than one customManager; they would open competing bumps. Narrow the regexes.`);
      }
    }
  }
  return errors.length ? [...new Set(errors)].join('\n') : null;
}

module.exports = { coverageError, entryShapeError, orphanRuleError, cliPinError };

if (require.main === module) {
  const catalog = readCatalog();
  const renovate = JSON.parse(fs.readFileSync(path.join(root, 'renovate.json'), 'utf8'));

  const workflowDir = path.join(root, '.github', 'workflows');
  const workflows = fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f)).map((f) =>
    ({ file: `.github/workflows/${f}`, text: fs.readFileSync(path.join(workflowDir, f), 'utf8') }));

  // Every check runs: a shape error must not hide a coverage error until the next run.
  const errors = [entryShapeError(catalog.plugins), coverageError(catalog, renovate),
    orphanRuleError(catalog, renovate), cliPinError(workflows, renovate)].filter(Boolean);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }

  // The count, not just "ok": zero entries and zero matches also passes, and that
  // is the one green worth being able to spot.
  console.log(`Renovate regex matches all ${externalCount(catalog)} external entries; ` +
    `every global npm install in ${workflows.length} workflows is pinned and claimed.`);
}
