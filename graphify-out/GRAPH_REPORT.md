# Graph Report - skills  (2026-07-09)

## Corpus Check
- 19 files · ~8,914 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 52 nodes · 53 edges · 7 communities
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `85c47592`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Available skills
- filippo-skills
- check-renovate.js
- gen-readme.js
- gen-readme.test.js
- SKILL.md
- CONTEXT — domain glossary

## God Nodes (most connected - your core abstractions)
1. `Available skills` - 10 edges
2. `filippo-skills` - 9 edges
3. `renderCatalog()` - 5 edges
4. `CONTEXT — domain glossary` - 3 edges
5. `table()` - 3 edges
6. `repoOf()` - 2 edges
7. `isLocal()` - 2 edges
8. `replaceBetweenMarkers()` - 2 edges
9. `Add mode` - 1 edges
10. `Update mode` - 1 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (7 total, 0 thin omitted)

### Community 0 - "Available skills"
Cohesion: 0.20
Nodes (10): [antfu/skills](https://github.com/antfu/skills) — Vue/Nuxt ecosystem, Available skills, [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) — React, [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) — frontend design & image-gen, [mattpocock/skills](https://github.com/mattpocock/skills) — engineering & productivity, [mcollina/skills](https://github.com/mcollina/skills) — Node.js backend, Modes (bundled by the local `mode-router` plugin), [mvanhorn/cli-printing-press](https://github.com/mvanhorn/cli-printing-press) — CLI generation (+2 more)

### Community 1 - "filippo-skills"
Cohesion: 0.22
Nodes (8): Adding a new plugin, Adding this marketplace, Adding your own skill to a plugin, External skills (auto-updated by Renovate), filippo-skills, Installing skills (individually), Structure, Validating

### Community 2 - "check-renovate.js"
Cohesion: 0.22
Nodes (8): fs, manager, mk, mkPath, mkText, path, renovate, root

### Community 3 - "gen-readme.js"
Cohesion: 0.36
Nodes (7): fs, isLocal(), path, renderCatalog(), replaceBetweenMarkers(), repoOf(), table()

### Community 4 - "gen-readme.test.js"
Cohesion: 0.29
Nodes (6): assert, MARKETPLACE, META, MODES, { renderCatalog, table, replaceBetweenMarkers, START, END }, { test }

### Community 5 - "SKILL.md"
Cohesion: 0.40
Nodes (4): Add mode, Finish, Regenerate the README, Update mode

### Community 6 - "CONTEXT — domain glossary"
Cohesion: 0.50
Nodes (3): Catalog, CONTEXT — domain glossary, Mode router

## Knowledge Gaps
- **38 isolated node(s):** `Add mode`, `Update mode`, `Regenerate the README`, `Finish`, `Catalog` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Available skills` connect `Available skills` to `filippo-skills`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `filippo-skills` connect `filippo-skills` to `Available skills`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `renderCatalog()` connect `gen-readme.js` to `gen-readme.test.js`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `Add mode`, `Update mode`, `Regenerate the README` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._