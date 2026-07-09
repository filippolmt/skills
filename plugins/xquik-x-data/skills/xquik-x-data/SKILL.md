---
name: xquik-x-data
description: Use when planning Xquik REST API or remote MCP workflows for X data search, profile lookup, exports, monitoring, webhooks, or authenticated automation.
---

# Xquik X Data

Use this skill to plan source-backed Xquik API and remote MCP workflows.

## Source Truth

- Product docs: https://docs.xquik.com
- OpenAPI contract: https://xquik.com/openapi.json
- MCP manifest: https://xquik.com/.well-known/mcp.json
- MCP endpoint: https://xquik.com/mcp
- Source repository: https://github.com/Xquik-dev/x-twitter-scraper

## Workflow

1. Read source truth before naming endpoints, schemas, auth, limits, install steps, or response fields.
2. Prefer the REST API when the user needs exact HTTP contracts, application integration, exports, webhooks, or account workflows.
3. Prefer remote MCP when the user wants agent-side tool planning or Claude Code workflow guidance.
4. Keep authentication opt-in. Use API keys or OAuth bearer auth only when the user already has credentials.
5. Treat an unauthenticated `401` from `https://xquik.com/mcp` as expected auth behavior.
6. State uncertainty instead of inventing endpoint names, pricing, limits, or response fields.

## Output

- Name the source URL checked for each workflow claim.
- Keep examples minimal and credential-free.
- Avoid storing or printing API keys, bearer tokens, cookies, or webhook secrets.
