#!/usr/bin/env node
// mode-router — UserPromptSubmit hook.
//
// Fires on every prompt. Injects a routing directive that makes the model
// classify THIS request and invoke EXACTLY ONE skill — never both:
//   - coding task  -> invoke the `ponytail` skill (minimal code)
//   - anything else -> invoke the `caveman` skill (terse output)
//
// The hook only ROUTES; it carries no ruleset. The `caveman` and `ponytail`
// skills are the single source of truth for their behavior — the hook names
// which one the model must invoke, the model calls the Skill tool. Both skills
// must be installed and enabled for the invocation to land.
//
// A control file lets you override the auto behavior for a whole machine:
//   $XDG_CONFIG_HOME/mode-router/state.json (or ~/.config/mode-router/state.json)
//   { "mode": "auto" | "caveman" | "ponytail" | "off" }
// Missing / invalid -> "auto".

const fs = require('fs');
const path = require('path');
const os = require('os');

const CAVEMAN =
  'Non-coding request. Invoke the `caveman` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn.';

const PONYTAIL =
  'Coding request. Invoke the `ponytail` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn.';

const ROUTER =
  'MODE ROUTER — classify THIS request and invoke EXACTLY ONE skill, never both:\n' +
  '- Coding task (writing/editing/refactoring/debugging code, writing tests, ' +
  'choosing a library or dependency, implementing) -> invoke the `ponytail` skill ' +
  '(Skill tool), not caveman.\n' +
  '- Anything else (explaining, answering, planning, discussing, docs) -> invoke ' +
  'the `caveman` skill (Skill tool), not ponytail.\n' +
  'Invoke the chosen skill before responding; never invoke both.';

const VALID = ['auto', 'caveman', 'ponytail', 'off'];

function stateFile() {
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'mode-router')
    : path.join(os.homedir(), '.config', 'mode-router');
  return path.join(dir, 'state.json');
}

function readMode() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const m = String(s && s.mode).toLowerCase();
    if (VALID.includes(m)) return m;
  } catch (e) { /* missing / unreadable / invalid -> default */ }
  return 'auto';
}

const mode = readMode();
const out =
  mode === 'auto' ? ROUTER :
  mode === 'caveman' ? CAVEMAN :
  mode === 'ponytail' ? PONYTAIL :
  ''; // off

if (out) process.stdout.write(out);
process.exit(0);
