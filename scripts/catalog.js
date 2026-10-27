// catalog — the marketplace catalog and the shape of a plugin entry, in one place.
//
// Three scripts consume the catalog (gen-readme, check-name-collisions,
// check-renovate) and each one used to re-derive "is this a local plugin or an
// external entry?" from `source` on its own — four times over, counting the
// copy inside gen-readme's own drift guard. The predicates below are that
// question, asked once.
//
// The entry shape is also encoded a fifth time, as regexes in renovate.json,
// where no code can reach it. That copy cannot be removed — Renovate reads the
// file itself — which is exactly why check-renovate.js exists. Keeping the
// predicates here is what gives that guard something to compare against.

const fs = require('fs');
const path = require('path');

// The repo root, resolved from this file. Every consumer wants it and all three
// used to compute it themselves.
const root = path.join(__dirname, '..');
const MARKETPLACE = path.join(root, '.claude-plugin', 'marketplace.json');

// A local plugin's `source` is a repo-relative path STRING (`./plugins/x`); an
// external entry's is an OBJECT. That single difference in type is the whole
// local/external classification.
const isLocal = (e) => !!e && typeof e.source === 'string';
const isGitSubdir = (e) => !!e && !!e.source && e.source.source === 'git-subdir';
// An external entry is a git-subdir entry, or a url entry: a plugin that IS its
// whole upstream repo. Claude Code sparse-checks-out a git-subdir `path`, so `.`
// installs only the repo's top-level files; the url source clones it whole
// (docs/adr/0033-a-repo-root-plugin-is-a-url-entry.md).
const isUrl = (e) => !!e && !!e.source && e.source.source === 'url';
const isExternal = (e) => isGitSubdir(e) || isUrl(e);

// Every spelling of "the repo root" a `path` can take. For a git-subdir entry each
// one installs empty, which is why check-renovate rejects them.
const isRepoRoot = (p) => ['', '.', './', '/'].includes(String(p ?? '').trim());

// Where an external entry's plugin sits in its repo, with the root always `.`: a
// url entry is the root by definition.
const entryPath = (e) => (isUrl(e) || isRepoRoot(e.source.path) ? '.' : e.source.path);

// `owner/repo` for an external entry, null for anything else — including an
// entry with no usable `url`, which is not a repo we can name.
function repoOf(entry) {
  if (!isExternal(entry) || typeof entry.source.url !== 'string') return null;
  return entry.source.url.replace(/^https:\/\/github\.com\//, '');
}

// A bundle ships nothing of its own: its plugin entry exists to pull dependencies
// in. Derived, not listed — shipping no artifacts is what MAKES an entry a
// bundle, so a hand-kept list of names is the same fact maintained twice,
// drifting the first time a bundle is added.
//
// gen-readme consults this set twice, in opposite directions: subtracted from
// the catalog projection, selected for the bundle projection. Removing either
// use puts the bundles back out of sight — see
// docs/adr/0012-the-bundle-table-lives-next-to-the-install.md.
const ARTIFACT_DIRS = ['skills', 'commands', 'hooks', 'agents'];
function isBundle(entry) {
  return isLocal(entry) &&
    !ARTIFACT_DIRS.some((d) => fs.existsSync(path.join(root, entry.source, d)));
}

// The raw TEXT comes back beside the parsed entries on purpose: check-renovate
// matches Renovate's regexes against the file as written, so returning only the
// parsed form would make it read the same file a second time.
function readCatalog() {
  const text = fs.readFileSync(MARKETPLACE, 'utf8');
  return { text, plugins: JSON.parse(text).plugins || [] };
}

module.exports = { readCatalog, isLocal, isGitSubdir, isUrl, isExternal, isRepoRoot, entryPath, isBundle, repoOf, root, MARKETPLACE };
