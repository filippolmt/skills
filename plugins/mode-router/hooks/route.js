#!/usr/bin/env node
// mode-router — UserPromptSubmit hook.
//
// Fires on every prompt. Injects a routing directive that makes the model
// classify THIS request and apply EXACTLY ONE mode — never both:
//   - coding task  -> ponytail (minimal code)
//   - anything else -> caveman (terse output)
//
// The classification is model-decided: the hook injects the rule + both
// condensed rulesets, the model picks the winner per request.
//
// A control file lets you override the auto behavior for a whole machine:
//   $XDG_CONFIG_HOME/mode-router/state.json (or ~/.config/mode-router/state.json)
//   { "mode": "auto" | "caveman" | "ponytail" | "off" }
// Missing / invalid -> "auto". This is the single source of truth for the
// rulesets; the /mode-router skill only reads and flips the control file.

const fs = require('fs');
const path = require('path');
const os = require('os');

const CAVEMAN =
  'CAVEMAN MODE — respond terse. Drop articles (a/an/the), filler ' +
  '(just/really/basically/actually/simply), pleasantries, hedging. Fragments OK. ' +
  'Short synonyms (big not extensive, fix not "implement a solution for"). ' +
  'Technical terms exact. Code blocks, commit messages, security warnings, and ' +
  'irreversible-action confirmations: normal prose.';

const PONYTAIL =
  'PONYTAIL MODE — laziest solution that actually works. Question whether the task ' +
  'needs to exist at all (YAGNI). Standard library / native platform features before ' +
  'dependencies. One line before fifty. No unrequested abstractions. Shortest correct path.';

const ROUTER =
  'MODE ROUTER — classify THIS request and apply EXACTLY ONE mode, never both:\n' +
  '- Coding task (writing/editing/refactoring/debugging code, writing tests, ' +
  'choosing a library or dependency, implementing) -> apply PONYTAIL, ignore caveman.\n' +
  '- Anything else (explaining, answering, planning, discussing, docs) -> apply ' +
  'CAVEMAN, ignore ponytail.\n\n' +
  CAVEMAN + '\n\n' + PONYTAIL;

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
