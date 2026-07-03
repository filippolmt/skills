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
  'MODE ROUTER — pick EXACTLY ONE mode skill for this turn (never both) and ' +
  'invoke it (Skill tool) before responding, IN ADDITION to any other skill this ' +
  'turn dispatches:\n' +
  '- Coding task (writing/editing/refactoring/debugging code, writing tests, ' +
  'choosing a library or dependency, implementing) -> `ponytail`, not caveman.\n' +
  '- Anything else (explaining, answering, planning, discussing, docs) -> ' +
  '`caveman`, not ponytail.';

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

// In `auto`, classify on every prompt — including slash-command dispatches, so
// the mode (caveman/ponytail) applies ON TOP of whatever other skill the user
// launches. Skip only when the dispatched skill IS a mode skill: the user
// already picked one, so don't re-classify. A FORCED mode is a standing choice
// and applies regardless.
function slashModeSkill() {
  try {
    const p = JSON.parse(fs.readFileSync(0, 'utf8')).prompt;
    if (typeof p !== 'string') return false;
    const t = p.trimStart();
    if (!t.startsWith('/')) return false;
    const cmd = t.slice(1).split(/\s+/)[0].toLowerCase();
    return cmd.includes('caveman') || cmd.includes('ponytail');
  } catch (e) { return false; }
}

const mode = readMode();
const out =
  mode === 'caveman' ? CAVEMAN :
  mode === 'ponytail' ? PONYTAIL :
  mode === 'off' ? '' :
  slashModeSkill() ? '' : // auto: user already picked a mode via /caveman|/ponytail
  ROUTER;

if (out) process.stdout.write(out);
process.exit(0);
