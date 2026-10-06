# Upstream Codex equivalents

Checked against every repository and SHA currently pinned by `.claude-plugin/marketplace.json`.

## Scope

The catalog has 17 external source repositories. Its ordinary `SKILL.md` artifacts are Agent Skills and therefore portable by default. Every current external non-skill artifact comes from three repositories: `pbakaus/impeccable`, `cathrynlavery/diagram-design`, and `wshobson/agents`.

## Native package manifests with shared skills

Four other pinned sources publish native Codex package metadata, but reuse the same Agent Skill files already catalogued here rather than shipping behavioral alternatives:

- [Terraform Skill](https://github.com/antonbabenko/terraform-skill/blob/b59d2be9ff4db8f835c8459e05e325ba11e3a21f/.codex-plugin/plugin.json)
- [Cloudflare Skills](https://github.com/cloudflare/skills/blob/41e0d19858946d18af9ee2c2feebbe2e11d829ff/.codex-plugin/plugin.json)
- [HashiCorp Terraform plugin](https://github.com/hashicorp/agent-skills/blob/f706481af9b8fedb66de909f6243ad29601afa0c/plugins/terraform/.codex-plugin/plugin.json)
- [last30days](https://github.com/mvanhorn/last30days-skill/blob/5103ba478b380552207a3754b74c7655d64208cd/.codex-plugin/plugin.json)

Their catalogued `SKILL.md` artifacts remain `native`; copying a second variant would only duplicate the same source. Cloudflare's root package also declares MCP, but this marketplace catalogues individual Claude skill subdirectories rather than that upstream whole plugin, so the MCP is not currently a Claude artifact to project.

Archify contains an additional `.agents/skills/archify-review` repository-maintenance skill, but Archify does not call it at runtime; it is not an equivalent or dependency of the catalogued `archify` workflow.

The remaining pinned repositories contain ordinary Agent Skills and no separate Codex implementation at their pinned SHA.

## Impeccable

Pinned commit: `508d7e8955de3b3caf2d8676e85206723d41a887` (`skill-v4.5.0`).

Upstream provides Codex-specific implementations:

- [Codex Agent Skill](https://github.com/pbakaus/impeccable/blob/508d7e8955de3b3caf2d8676e85206723d41a887/.agents/skills/impeccable/SKILL.md)
- [four Codex TOML subagents](https://github.com/pbakaus/impeccable/tree/508d7e8955de3b3caf2d8676e85206723d41a887/.agents/skills/impeccable/agents)
- [`PostToolUse` and `Stop` hooks](https://github.com/pbakaus/impeccable/blob/508d7e8955de3b3caf2d8676e85206723d41a887/.codex/hooks.json)
- [provider smoke test that drives Codex and verifies hook output](https://github.com/pbakaus/impeccable/blob/508d7e8955de3b3caf2d8676e85206723d41a887/scripts/smoke-provider-hooks.mjs)

The [Claude plugin hook manifest](https://github.com/pbakaus/impeccable/blob/508d7e8955de3b3caf2d8676e85206723d41a887/plugin/hooks/hooks.json) also contains `SessionStart`; upstream's [harness matrix](https://github.com/pbakaus/impeccable/blob/508d7e8955de3b3caf2d8676e85206723d41a887/docs/HARNESSES.md) says Codex deliberately has no startup hook. That artifact remains unsupported with a manual fallback.

## Diagram Design

Pinned commit: `3996c1607503ec4bcdb60b018568359d20f71d15`.

Upstream ships a [native Codex manifest](https://github.com/cathrynlavery/diagram-design/blob/3996c1607503ec4bcdb60b018568359d20f71d15/.codex-plugin/plugin.json) and [Codex marketplace](https://github.com/cathrynlavery/diagram-design/blob/3996c1607503ec4bcdb60b018568359d20f71d15/.agents/plugins/marketplace.json). Its six Claude commands are thin routes into shared references under `skills/diagram-design/references/`; the Codex package exposes those same workflows through the shared skill. [`scripts/test-verify-docs-sync.py`](https://github.com/cathrynlavery/diagram-design/blob/3996c1607503ec4bcdb60b018568359d20f71d15/scripts/test-verify-docs-sync.py) checks the native surfaces and command/reference routing.

The six commands are therefore adapted to their upstream shared references rather than translated into new duplicate skills.

## Wshobson Agents

Pinned commit: `46891e7e60da0e52baf1050b7b6391b64e84c6d9`.

Both catalogued whole plugins have native Codex manifests:

- [`api-scaffolding/.codex-plugin/plugin.json`](https://github.com/wshobson/agents/blob/46891e7e60da0e52baf1050b7b6391b64e84c6d9/plugins/api-scaffolding/.codex-plugin/plugin.json)
- [`shell-scripting/.codex-plugin/plugin.json`](https://github.com/wshobson/agents/blob/46891e7e60da0e52baf1050b7b6391b64e84c6d9/plugins/shell-scripting/.codex-plugin/plugin.json)

Those manifests package only `skills/`; they do not provide Codex equivalents for the six Claude Markdown agents. The agents therefore still require the repository's planned deterministic skill conversion. Treating the native manifest alone as parity would silently drop them.

## Result

Upstream-owned Codex implementations are now recorded with pinned `sourcePath` and `evidencePath` values in `scripts/distribution-meta.json`. Validation fails if either path disappears on a future upstream update. Remaining external gap: Impeccable `SessionStart`; remaining generated adaptations: the six Wshobson agents.
