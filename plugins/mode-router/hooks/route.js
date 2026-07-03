#!/usr/bin/env node
// mode-router — UserPromptSubmit hook.
//
// Fires on every prompt. In `auto` mode it emits the ROUTER directive below —
// the canonical rule lives in that string, not here — making the model classify
// THIS request and invoke exactly one skill. The hook only ROUTES; the
// `caveman`/`ponytail` skills own their behavior (declared as dependencies).
//
// A control file overrides auto for a whole machine (missing/invalid -> "auto"):
//   $XDG_CONFIG_HOME/mode-router/state.json (or ~/.config/mode-router/state.json)

const fs = require('fs');
const path = require('path');
const os = require('os');

// Force modes assert no classification — they apply regardless of request type.
const CAVEMAN =
  'Forced caveman mode: invoke the `caveman` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn — regardless of request type.';

const PONYTAIL =
  'Forced ponytail mode: invoke the `ponytail` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn — regardless of request type.';

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

// In `auto`, skip when the user explicitly dispatched to a skill (slash
// command) — they already chose, so don't classify on top of it. A FORCED
// mode is a standing choice and still applies (e.g. pin ponytail for a
// slash-dispatched spec-driven workflow).
function isSlashCommand() {
  try {
    const p = JSON.parse(fs.readFileSync(0, 'utf8')).prompt;
    return typeof p === 'string' && p.trimStart().startsWith('/');
  } catch (e) { return false; }
}

const mode = readMode();
const out =
  mode === 'caveman' ? CAVEMAN :
  mode === 'ponytail' ? PONYTAIL :
  mode === 'off' ? '' :
  isSlashCommand() ? '' : // auto: don't classify on top of an explicit /skill dispatch
  ROUTER;

if (out) process.stdout.write(out);
process.exit(0);
