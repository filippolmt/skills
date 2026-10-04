---
status: accepted
---

# Share files between local plugins by symlink

`subito-listing` and `subito-research` both run the same extraction script
against Subito's search pages. Each plugin installs on its own, so neither can
reach a file inside the other at runtime, and a component path that escapes the
plugin root is rejected. The first version kept two identical copies, synced by
hand — the duplication that drifts the first time one copy is fixed.

A file shared by local plugins lives once under `shared/<topic>/` at the repo
root, and each plugin reaches it through a **relative symlink** placed where its
skill expects the file (`skills/<skill>/scripts/annunci.js`). Claude Code
documents this case: when it copies a plugin from a git-hosted marketplace into
its cache, a symlink that resolves elsewhere in the same marketplace is
dereferenced — the target's content is copied in its place — so every installed
plugin holds a real file. See "Share files within a marketplace with symlinks"
in the Claude Code docs (*Host and maintain a marketplace*).

`shared/` is neutral ground: removing one plugin must not break the other, which
it would if the file lived inside either of them.

Rejected: merging the two skills into one plugin. It would share the file with a
plain relative path, but buys that by breaking the one-skill-per-entry default
and making a buyer install the seller's skill.

## Consequences

- The script is edited in `shared/subito/annunci.js`, nowhere else.
- A marketplace added from a **local path** skips symlinks that leave the plugin
  directory; in that setup the plugins load in place from the repo, where the
  link resolves on disk. Installs from GitHub get the dereferenced copy.
- Neither guarantee is covered by `claude plugin validate`; after a release,
  check that the cached plugin holds the file
  (`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/…`).
