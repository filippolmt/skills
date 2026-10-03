---
status: accepted
---

# Credit the upstream author

The marketplace owner publishes the catalog; that does not make them the author
of every entry. An entry without its own `author` can inherit the marketplace
owner in consumer-facing metadata, incorrectly crediting Filippo for third-party
work.

Every git-subdir entry carries the upstream author's name and URL. Use upstream
metadata or licence attribution rather than inferring authorship from who added
the entry. A source with several credited authors keeps all of them in the name.

A bundle is credited to the author of the external skill it exists to install,
not to the person who wrote the dependency manifest. Local guards and original
local artifacts keep their local author.

## Consequences

- New and updated external entries refresh `author` alongside `description`.
- Existing external entries identify their upstream authors explicitly.
- Changing a local plugin's author changes its manifest and therefore receives a
  patch version bump.
