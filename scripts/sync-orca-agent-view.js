#!/usr/bin/env node
// Rebuilds plugins/orca-agent-view from a checkout of stablyai/orca (ADR-0046).
// Usage: node scripts/sync-orca-agent-view.js <orca-checkout> [plugin-dir]
//
// Orca generates the plugin at runtime from TypeScript, so there is no upstream
// folder to pin. This script reads that TypeScript as text and never runs it:
// the template's interpolations are resolved here, and one it does not know
// fails the sync instead of shipping a register.js that differs from Orca's.
const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('node:module');

const SOURCES = {
  mod: 'src/main/claude/agent-view/agent-view-mod-source.ts',
  plugin: 'src/main/claude/agent-view/agent-view-plugin.ts',
  endpoint: 'src/shared/agent-hook-listener/transport/agent-hook-endpoint-file.ts',
  constants: 'src/shared/agent-hook-listener/providers/claude/view/claude-agent-view.ts',
};
const NAME = 'orca-agent-view';
const HOOKS_JSON = JSON.stringify({ modules: ['./register.js'] });

function fail(message) {
  throw new Error(`orca-agent-view sync: ${message}; Orca changed how it builds the plugin, update this script`);
}

function constant(text, name) {
  const match = text.match(new RegExp(`export const ${name} = '([^']*)'`));
  if (!match) fail(`${name} not found`);
  return match[1];
}

// The text of parseAgentHookEndpointFile as `.toString()` returns it at runtime:
// a plain function declaration without types.
function endpointParser(text) {
  const start = text.indexOf('export function parseAgentHookEndpointFile(');
  const end = text.indexOf('\n}\n', start);
  if (start < 0 || end < 0) fail('parseAgentHookEndpointFile not found');
  // stripTypeScriptTypes warns that it is experimental on every run; that warning is expected, not a signal.
  const { emitWarning } = process;
  process.emitWarning = (warning, ...rest) => (/stripTypeScriptTypes/.test(warning) ? undefined : emitWarning.call(process, warning, ...rest));
  let js;
  try {
    js = stripTypeScriptTypes(text.slice(start + 'export '.length, end + 2), { mode: 'transform' }).trim();
  } finally {
    process.emitWarning = emitWarning;
  }
  if (!/^function parseAgentHookEndpointFile\(/.test(js)) fail('parseAgentHookEndpointFile is not a plain function');
  return js;
}

// sources: the text of each SOURCES file. Returns the generated files and Orca's version.
function build(sources) {
  if (constant(sources.constants, 'CLAUDE_AGENT_VIEW_PLUGIN') !== NAME) fail('the plugin name changed');
  if (constant(sources.constants, 'CLAUDE_AGENT_VIEW_COMMAND') !== NAME) fail('the command name changed');

  const plugin = sources.plugin;
  const keys = [...(plugin.match(/CLAUDE_AGENT_VIEW_PLUGIN_FILES[^{]*\{([\s\S]*?)\n\}/) || [, ''])[1].matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]);
  if (keys.join() !== '.claude-plugin/plugin.json,hooks/hooks.json,hooks/register.js') fail(`unexpected plugin files: ${keys.join(', ')}`);
  if (!plugin.includes("'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] })")) fail('hooks.json changed');
  if (!plugin.includes("'hooks/register.js': CLAUDE_AGENT_VIEW_MOD_SOURCE")) fail('register.js no longer comes from the mod source');
  const version = (plugin.match(/version: '(\d+\.\d+\.\d+)'/) || fail('version not found'))[1];

  const template = (sources.mod.match(/String\.raw`([\s\S]*?)`\.trimStart\(\)/) || fail('mod template not found'))[1];
  const values = {
    'parseAgentHookEndpointFile.toString()': () => endpointParser(sources.endpoint),
    'JSON.stringify(CLAUDE_AGENT_VIEW_PATH)': () => JSON.stringify(constant(sources.constants, 'CLAUDE_AGENT_VIEW_PATH')),
  };
  const register = template
    .replace(/\$\{([^}]*)\}/g, (_, expr) => (values[expr] || fail(`unknown interpolation \${${expr}}`))())
    .trimStart();
  return { version, files: { 'hooks/hooks.json': HOOKS_JSON, 'hooks/register.js': register } };
}

// Orca keeps its version fixed across content changes (its install path hashes
// the content), so a changed file bumps our patch unless Orca moved ahead.
function nextVersion(ours, theirs) {
  const parse = (v) => v.split('.').map(Number);
  const [a, b] = [parse(ours), parse(theirs)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i] ? theirs : `${a[0]}.${a[1]}.${a[2] + 1}`;
  return `${a[0]}.${a[1]}.${a[2] + 1}`;
}

function sync(orcaDir, pluginDir) {
  const sources = Object.fromEntries(Object.entries(SOURCES).map(([k, p]) => [k, fs.readFileSync(path.join(orcaDir, p), 'utf8')]));
  const { version, files } = build(sources);
  const changed = Object.entries(files).filter(([p, text]) => {
    const file = path.join(pluginDir, p);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
    fs.writeFileSync(file, text);
    return true;
  });
  if (changed.length) {
    const manifestPath = path.join(pluginDir, '.claude-plugin/plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = nextVersion(manifest.version, version);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return changed.map(([p]) => p);
}

module.exports = { build, nextVersion };

if (require.main === module) {
  const [orcaDir, pluginDir = path.join(__dirname, '../plugins/orca-agent-view')] = process.argv.slice(2);
  if (!orcaDir) {
    console.error('usage: node scripts/sync-orca-agent-view.js <orca-checkout> [plugin-dir]');
    process.exit(2);
  }
  const changed = sync(orcaDir, pluginDir);
  console.log(changed.length ? `changed: ${changed.join(', ')}` : 'unchanged');
}
