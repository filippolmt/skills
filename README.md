# filippo-skills

A Claude Code plugin marketplace — a collection of reusable skills installable
via git.

## Structure

```
.claude-plugin/marketplace.json   # marketplace catalog
plugins/
  mode-router/
    .claude-plugin/plugin.json     # plugin manifest
    hooks/hooks.json               # UserPromptSubmit hook (auto-loaded)
    skills/
      mode-router/SKILL.md         # skill
```

## Adding this marketplace

Register it once, then it shows up in `/plugin`:

```
/plugin marketplace add filippolmt/skills
```

(Any git remote works too, e.g. `/plugin marketplace add https://github.com/filippolmt/skills`.)

## Installing skills (individually)

Each skill is its own plugin, so you only install the ones you want:

```
/plugin install tdd
/plugin install grill-me
```

Then invoke them namespaced: `/tdd:tdd`, `/grill-me:grill-me`. Model-invoked
skills (e.g. `grilling`) are triggered by Claude automatically when relevant.

To refresh after upstream updates:

```
/plugin marketplace update filippo-skills
```

## Available skills

Snapshot of the catalog — the source of truth is
[`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).

<!-- catalog:start -->
**Local:** `mode-router` — Per-prompt router: classifies each request and invokes the caveman (terse output) or ponytail (minimal code) skill, exclusively. Force a mode or turn it off via control file. Bundles both as dependencies.

### [mattpocock/skills](https://github.com/mattpocock/skills) — engineering & productivity

| Skill | What it does |
|---|---|
| `ask-matt` | Ask which skill or flow fits your situation. |
| `diagnosing-bugs` | Diagnosis loop for hard bugs and performance regressions. |
| `grill-with-docs` | A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. |
| `triage` | Move issues and external PRs through a state machine of triage roles — categorise, verify, grill if needed, and write agent-ready briefs. |
| `resolving-merge-conflicts` | Use when you need to resolve an in-progress git merge/rebase conflict. |
| `wayfinder` | Plan a huge chunk of work — more than one agent session can hold — as a shared map of investigation tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear. |
| `improve-codebase-architecture` | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick. |
| `setup-matt-pocock-skills` | Configure this repo for the engineering skills — set up its issue tracker, triage label vocabulary, and domain doc layout. |
| `tdd` | Test-driven development. |
| `to-tickets` | Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in a local file, or native blocking links on a real tracker. |
| `to-spec` | Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed. |
| `implement` | Implement a piece of work based on a spec or set of tickets. |
| `prototype` | Build a throwaway prototype to answer a design question. |
| `research` | Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. |
| `domain-modeling` | Build and sharpen a project's domain model. |
| `codebase-design` | Shared vocabulary for designing deep modules. |
| `code-review` | Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes — Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/PRD asked for?). |
| `grill-me` | A relentless interview to sharpen a plan or design. |
| `grilling` | Grill the user relentlessly about a plan or design. |
| `handoff` | Compact the current conversation into a handoff document for another agent to pick up. |
| `teach` | Teach the user a new skill or concept, within this workspace. |
| `writing-great-skills` | Reference for writing and editing skills well — the vocabulary and principles that make a skill predictable. |

### [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) — frontend design & image-gen

| Skill | What it does |
|---|---|
| `brandkit` | Premium brand-kit image generation skill for creating high-end brand-guidelines boards, logo systems, identity decks, and visual-world presentations. |
| `brutalist-skill` | Raw mechanical interfaces fusing Swiss typographic print with military terminal aesthetics. |
| `gpt-tasteskill` | Elite UX/UI & Advanced GSAP Motion Engineer. |
| `image-to-code-skill` | Elite website image-to-code skill for Codex. |
| `imagegen-frontend-mobile` | Elite mobile app image-generation skill for creating premium, app-native screen concepts and flows. |
| `imagegen-frontend-web` | Elite frontend image-direction skill for generating premium, conversion-aware website design references. |
| `minimalist-skill` | Clean editorial-style interfaces. |
| `output-skill` | Overrides default LLM truncation behavior. |
| `redesign-skill` | Upgrades existing websites and apps to premium quality. |
| `soft-skill` | Teaches the AI to design like a high-end agency. |
| `stitch-skill` | Semantic Design System Skill for Google Stitch. |
| `taste-skill-v1` | The original v1 taste-skill, preserved for projects depending on its exact behavior. |
| `taste-skill` | Anti-slop frontend skill for landing pages, portfolios, and redesigns. |

### [mvanhorn/cli-printing-press](https://github.com/mvanhorn/cli-printing-press) — CLI generation

| Skill | What it does |
|---|---|
| `printing-press` | Generate a ship-ready CLI for an API via a lean research → generate → build → shipcheck loop. |
| `printing-press-polish` | Polish a generated CLI to pass verification and become publish-ready: runs diagnostics (dogfood, verify, scorecard, go vet, gosec), auto-fixes issues, and reports the before/after delta. |
| `printing-press-score` | Score a generated CLI against the Steinberger bar, or compare two CLIs side-by-side. |
| `printing-press-output-review` | Internal sub-skill: agentic review of a printed CLI's sampled command output for plausibility issues rule-based checks can't catch. Invoked by printing-press and printing-press-polish; not for direct use. |

### [wshobson/agents](https://github.com/wshobson/agents) — backend scaffolding

| Plugin | What it bundles |
|---|---|
| `api-scaffolding` | REST and GraphQL API scaffolding: backend-architect, fastapi-pro, django-pro, and graphql-architect agents plus the fastapi-templates skill. |
| `shell-scripting` | Production-grade Bash scripting: bash-pro and posix-shell-pro agents plus the bash-defensive-patterns, bats-testing-patterns, and shellcheck-configuration skills. |

### [antfu/skills](https://github.com/antfu/skills) — Vue/Nuxt ecosystem

| Skill | What it does |
|---|---|
| `nuxt` | Nuxt full-stack Vue framework with SSR, auto-imports, and file-based routing. |

### [mcollina/skills](https://github.com/mcollina/skills) — Node.js backend

| Skill | What it does |
|---|---|
| `fastify-best-practices` | Guides development of Fastify Node.js backend servers and REST APIs using TypeScript or JavaScript. |

### [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) — React

| Skill | What it does |
|---|---|
| `react-expert` | Use when building React 18+ applications in .jsx or .tsx files, Next.js App Router projects, or create-react-app setups. |
| `wordpress-pro` | Develops custom WordPress themes and plugins, creates and registers Gutenberg blocks and block patterns, configures WooCommerce stores, implements WordPress REST API endpoints, applies security hardening, and optimizes performance through caching and query tuning. |
| `fastapi-expert` | Use when building high-performance async Python APIs with FastAPI and Pydantic V2. |
| `kubernetes-specialist` | Use when deploying or managing Kubernetes workloads. |
| `golang-pro` | Implements concurrent Go patterns using goroutines and channels, designs and builds microservices with gRPC or REST, optimizes Go application performance with pprof, and enforces idiomatic Go with generics, interfaces, and robust error handling. |
| `cli-developer` | Use when building CLI tools, implementing argument parsing, or adding interactive prompts. |
| `code-documenter` | Generates, formats, and validates technical documentation — including docstrings, OpenAPI/Swagger specs, JSDoc annotations, doc portals, and user guides. |
| `database-optimizer` | Optimizes database queries and improves performance across PostgreSQL and MySQL systems. |
| `playwright-expert` | Use when writing E2E tests with Playwright, setting up test infrastructure, or debugging flaky browser tests. |
| `sql-pro` | Optimizes SQL queries, designs database schemas, and troubleshoots performance issues. |

### [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) — UI/UX design

| Skill | What it does |
|---|---|
| `ui-ux-pro-max` | UI/UX design intelligence for web and mobile. |

### [antonbabenko/terraform-skill](https://github.com/antonbabenko/terraform-skill) — Terraform/OpenTofu IaC

| Skill | What it does |
|---|---|
| `terraform-skill` | Diagnose-first guidance for writing, reviewing, and debugging Terraform/OpenTofu modules, tests, CI, scans, and state ops — pinpoints the failure mode (identity churn, secrets, blast radius, CI drift, state corruption) with version-aware guards. |

### [cloudflare/skills](https://github.com/cloudflare/skills) — Cloudflare developer platform

| Skill | What it does |
|---|---|
| `agents-sdk` | Build AI agents on Cloudflare Workers using the Agents SDK — stateful agents, durable workflows, WebSocket apps, scheduled tasks, MCP servers. |
| `cloudflare-email-service` | Send and receive transactional emails with Cloudflare Email Service (Email Sending + Email Routing). |
| `cloudflare-one-migrations` | Plan migrations from Zscaler ZIA/ZPA, Palo Alto, legacy VPN, SWG, or SASE stacks to Cloudflare One. |
| `cloudflare-one` | Guides Cloudflare One Zero Trust and SASE work across Access, Gateway, WARP, Tunnel, WAN, DLP, CASB, device posture, and identity. |
| `cloudflare` | Comprehensive Cloudflare platform skill: Workers, Pages, storage (KV, D1, R2), AI, networking, security, and infrastructure-as-code. |
| `durable-objects` | Create and review Cloudflare Durable Objects — stateful coordination, RPC methods, SQLite storage, alarms, and WebSockets. |
| `sandbox-sdk` | Build sandboxed applications for secure code execution with the Sandbox SDK — code interpreters, CI/CD, and untrusted code. |
| `turnstile-spin` | Set up Cloudflare Turnstile end-to-end — scan the codebase, create the widget, deploy the siteverify Worker, and write frontend snippets. |
| `web-perf` | Analyze web performance via Chrome DevTools MCP — Core Web Vitals, render-blocking resources, layout shifts, and caching. |
| `workers-best-practices` | Review and author Cloudflare Workers code against production best practices and common anti-patterns. |
| `wrangler` | Cloudflare Workers CLI for deploying, developing, and managing Workers, KV, R2, D1, Queues, Workflows, and Secrets. |

### Modes (bundled by the local `mode-router` plugin)

| Skill | Source | What it does |
|---|---|---|
| `caveman` | [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) | Ultra-compressed communication mode. |
| `ponytail` | [dietrichgebert/ponytail](https://github.com/dietrichgebert/ponytail) | Forces the laziest solution that actually works, simplest, shortest, most minimal. |
<!-- catalog:end -->

## External skills (auto-updated by Renovate)

Third-party skills (e.g. `mattpocock/skills`) are referenced upstream via
`git-subdir` — no files are copied. Each skill subdirectory becomes a
single-skill plugin you can install on its own. Renovate bumps the pinned commit
whenever upstream changes (automerge enabled).

The fastest way to add one is the `/add-external-skill` skill, which automates
every step below. Point it at a skill folder to add one skill, or at a repo /
parent folder to batch-add every `SKILL.md` under it:

```
/add-external-skill <owner/repo> [path/to/skill-folder] [name]
```

To do it by hand instead:

1. Get the current branch SHA:

   ```bash
   curl -fsSL https://api.github.com/repos/<owner>/<repo>/commits/main \
     -H "Accept: application/vnd.github.sha"
   ```
2. Add an entry to `.claude-plugin/marketplace.json` (one per skill):

   ```json
   {
     "name": "<skill-name>",
     "source": {
       "source": "git-subdir",
       "url": "https://github.com/<owner>/<repo>",
       "path": "<path/to/skill-folder>",
       "ref": "main",
       "sha": "<sha-from-step-1>"
     },
     "description": "..."
   }
   ```
3. Done. The `customManager` in `renovate.json` matches every entry of this shape
   (github `url` + `path` + `ref` + `sha`), tracks the branch via the `git-refs`
   datasource, and opens SHA-bump PRs that merge themselves (automerge). Entries
   from the same repo are grouped into a single PR.

The folder pointed to by `path` must be a valid skill (contain `SKILL.md`).

## Adding your own skill to a plugin

1. Create `plugins/<plugin>/skills/<name>/SKILL.md`.
2. Minimal frontmatter:

   ```yaml
   ---
   name: <name>
   description: <when and why to use it — drives automatic triggering>
   ---
   ```
3. Write the operating instructions in the body. Done — invocable as
   `/<plugin>:<name>`.

Fastest path: copy `plugins/mode-router/skills/mode-router/` as a starting point.

## Adding a new plugin

1. Create `plugins/<plugin-name>/.claude-plugin/plugin.json`:

   ```json
   {
     "name": "<plugin-name>",
     "description": "...",
     "version": "0.1.0",
     "author": { "name": "Filippo Merante Caparrotta" }
   }
   ```
2. Add skills under `plugins/<plugin-name>/skills/`.
3. Register the plugin in `.claude-plugin/marketplace.json` by adding an entry to
   the `plugins` array (the `source` is relative to the repo root, e.g.
   `"./plugins/<plugin-name>"`).

## Validating

```
claude plugin validate .                     # marketplace + all local plugins
claude plugin validate ./plugins/mode-router # single plugin + skill
```
