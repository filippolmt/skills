#!/usr/bin/env node
// mode-router — UserPromptSubmit + SessionStart hook (one script, two events).
//
// The mode skills (caveman/ponytail) declare themselves "active every response",
// so once loaded they persist WITHOUT re-injecting SKILL.md every turn. Reloading
// is only needed when the context was (re)started or a compaction cleared them.
//
// SessionStart (startup|resume|clear|compact) writes a per-session RELOAD FLAG.
// The next UserPromptSubmit consumes it: flag present => context is fresh, so
// (re)invoke the skill; flag absent => the skill is still in context, don't
// reload. This makes compaction detection DETERMINISTIC (SessionStart fires with
// source=compact after every auto/manual compaction) instead of relying on the
// model to notice the skill is gone.
//
// `auto` is special: the right mode varies per request, so the classifier fires
// EVERY turn regardless of the flag — the flag only decides whether the chosen
// skill must be (re)invoked or is already active from an earlier turn.
//
// A control file overrides auto for a whole machine (missing/invalid -> "auto"):
//   $XDG_CONFIG_HOME/mode-router/state.json (or ~/.config/mode-router/state.json)

const fs = require('fs');
const path = require('path');
const os = require('os');

// Forced-mode directives — emitted ONLY when a reload is actually needed
// (fresh/compacted context), so they can assert "invoke now" unconditionally.
const CAVEMAN =
  'Forced caveman mode: invoke the `caveman` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn — regardless of request type.';

const PONYTAIL =
  'Forced ponytail mode: invoke the `ponytail` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn — regardless of request type.';

const ROUTER_HEAD =
  'MODE ROUTER — classify THIS request and keep EXACTLY ONE mode skill active ' +
  '(never both), IN ADDITION to any other skill this turn dispatches:\n' +
  '- Coding task (writing/editing/refactoring/debugging code, writing tests, ' +
  'choosing a library or dependency, implementing) -> `ponytail`, not caveman.\n' +
  '- Anything else (explaining, answering, planning, discussing, docs) -> ' +
  '`caveman`, not ponytail.\n';

// Reset: context is fresh/compacted, no mode skill is loaded -> invoke now.
const ROUTER_RESET = ROUTER_HEAD +
  'Invoke the chosen skill now (Skill tool, before responding): the context was ' +
  'just (re)started or compacted, so no mode skill is active.';

// No reset: a mode skill may already be active from an earlier turn -> only
// re-invoke on a mode switch (inherent model judgment; the hook can't know the
// request type).
const ROUTER_KEEP = ROUTER_HEAD +
  'If the needed skill is already the active mode from an earlier turn this ' +
  'session, do nothing — it persists. Invoke it (Skill tool, before responding) ' +
  'only when switching modes.';

const VALID = ['auto', 'caveman', 'ponytail', 'off'];

function configDir() {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'mode-router')
    : path.join(os.homedir(), '.config', 'mode-router');
}

function readMode() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(configDir(), 'state.json'), 'utf8'));
    const m = String(s && s.mode).toLowerCase();
    if (VALID.includes(m)) return m;
  } catch (e) { /* missing / unreadable / invalid -> default */ }
  return 'auto';
}

// One flag file per session. ponytail: a session that starts but never prompts
// leaves one empty file behind — harmless, that session_id won't recur.
function reloadFlag(sessionId) {
  const id = String(sessionId || 'default').replace(/[^\w.-]/g, '_');
  return path.join(configDir(), `reload-${id}`);
}

// Both events carry the common `session_id` + `hook_event_name` fields.
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

// SessionStart (any source): mark the skill to be (re)loaded on the next prompt.
if (input.hook_event_name === 'SessionStart') {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(reloadFlag(input.session_id), '');
  } catch (e) { /* best effort */ }
  process.exit(0);
}

// UserPromptSubmit: consume the flag (delete it) to learn whether the context
// was just reset since the last prompt.
const flag = reloadFlag(input.session_id);
let reset = false;
try { fs.unlinkSync(flag); reset = true; } catch (e) { /* no flag => not reset */ }

// In `auto`, skip re-classifying only when the user explicitly launched a mode
// skill via /caveman|/ponytail — they already picked one for this turn.
function slashModeSkill() {
  const p = typeof input.prompt === 'string' ? input.prompt : input.user_prompt;
  if (typeof p !== 'string') return false;
  const t = p.trimStart();
  if (!t.startsWith('/')) return false;
  const cmd = t.slice(1).split(/\s+/)[0].toLowerCase();
  return cmd.includes('caveman') || cmd.includes('ponytail');
}

const mode = readMode();
const out =
  mode === 'off' ? '' :
  // Forced modes are deterministic: reload only when the context was reset.
  mode === 'caveman' ? (reset ? CAVEMAN : '') :
  mode === 'ponytail' ? (reset ? PONYTAIL : '') :
  // auto: always classify; the flag picks reset vs keep wording.
  slashModeSkill() ? '' :
  reset ? ROUTER_RESET : ROUTER_KEEP;

if (out) process.stdout.write(out);
process.exit(0);
