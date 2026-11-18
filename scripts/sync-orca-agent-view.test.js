#!/usr/bin/env node
// Self-check for sync-orca-agent-view.js. Run: node scripts/sync-orca-agent-view.test.js
//
// The sync's safety rests on failing when Orca changes its generator, so most
// cases below are sources it must refuse.
const assert = require('assert');
const { build, nextVersion } = require('./sync-orca-agent-view.js');

const SOURCES = {
  mod: [
    "import { CLAUDE_AGENT_VIEW_PATH } from './x'",
    'export const CLAUDE_AGENT_VIEW_MOD_SOURCE = String.raw`',
    'const parseEndpoint = ${parseAgentHookEndpointFile.toString()}',
    "const path = ${JSON.stringify(CLAUDE_AGENT_VIEW_PATH)}",
    "const re = /\\d+/",
    '`.trimStart()',
  ].join('\n'),
  plugin: [
    'export const CLAUDE_AGENT_VIEW_PLUGIN_FILES: Record<string, string> = {',
    "  '.claude-plugin/plugin.json': JSON.stringify({",
    "    name: CLAUDE_AGENT_VIEW_PLUGIN,",
    "    version: '0.3.0',",
    '  }),',
    "  'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),",
    "  'hooks/register.js': CLAUDE_AGENT_VIEW_MOD_SOURCE",
    '}',
  ].join('\n'),
  endpoint: [
    'export type AgentHookEndpoint = { port: string }',
    'export function parseAgentHookEndpointFile(contents: string): AgentHookEndpoint {',
    '  return { port: contents as string }',
    '}',
    '',
  ].join('\n'),
  constants: [
    "export const CLAUDE_AGENT_VIEW_PATH = '/claude/agent-view'",
    "export const CLAUDE_AGENT_VIEW_COMMAND = 'orca-agent-view'",
    "export const CLAUDE_AGENT_VIEW_PLUGIN = 'orca-agent-view'",
  ].join('\n'),
};

const { version, files } = build(SOURCES);
assert.strictEqual(version, '0.3.0');
assert.strictEqual(files['hooks/hooks.json'], '{"modules":["./register.js"]}');
const register = files['hooks/register.js'];
assert.match(register, /^const parseEndpoint = function parseAgentHookEndpointFile\(contents\) \{/);
assert.doesNotMatch(register, /: string|\): AgentHookEndpoint|as string/, 'types are stripped');
assert.ok(register.includes('const path = "/claude/agent-view"'));
assert.ok(register.includes('const re = /\\d+/'), 'String.raw keeps backslashes');

const refuses = (patch, message) => assert.throws(() => build({ ...SOURCES, ...patch }), message);
refuses({ mod: SOURCES.mod.replace('${JSON.stringify(CLAUDE_AGENT_VIEW_PATH)}', '${OTHER}') }, /unknown interpolation \$\{OTHER\}/);
refuses({ constants: SOURCES.constants.replace("PLUGIN = 'orca-agent-view'", "PLUGIN = 'orca-view'") }, /plugin name changed/);
refuses({ constants: SOURCES.constants.replace("COMMAND = 'orca-agent-view'", "COMMAND = 'orca-view'") }, /command name changed/);
refuses({ plugin: SOURCES.plugin.replace("  'hooks/register.js'", "  'hooks/extra.js': X,\n  'hooks/register.js'") }, /unexpected plugin files/);
refuses({ plugin: SOURCES.plugin.replace("['./register.js']", "['./register.mjs']") }, /hooks\.json changed/);
refuses({ mod: SOURCES.mod.replace('`.trimStart()', '`') }, /mod template not found/);
refuses({ endpoint: SOURCES.endpoint.replace('export function', 'export const f = function') }, /parseAgentHookEndpointFile not found/);

assert.strictEqual(nextVersion('0.2.0', '0.2.0'), '0.2.1');
assert.strictEqual(nextVersion('0.2.3', '0.2.0'), '0.2.4');
assert.strictEqual(nextVersion('0.2.3', '0.3.0'), '0.3.0');
assert.strictEqual(nextVersion('0.10.0', '0.9.9'), '0.10.1');

console.log('sync-orca-agent-view: ok');
