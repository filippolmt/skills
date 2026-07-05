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

// Precedence: a mode skill compresses/simplifies STYLE only — it never changes the
// output language or drops required orthography (caveman preserves the user's
// language and its accents), so a language/orthography rule is NOT a conflict. A
// real conflict is only an explicit anti-brevity instruction this turn, or a hard
// rule banning compression itself. The hook is stateless and can't detect those,
// so it tells the model how to resolve the clash instead of improvising.
const PRECEDENCE =
  ' Precedence: the mode compresses/simplifies STYLE only — it never changes the ' +
  'output language or drops required orthography (accents, etc.), so a ' +
  'language/orthography rule is NOT a conflict. It conflicts only with an explicit ' +
  'anti-brevity instruction this turn (e.g. "be thorough / don\'t be brief") or a ' +
  'hard rule banning compression itself: then the constraint wins — apply the mode ' +
  'where compatible, else skip it and note the deviation in one line.';

// Forced-mode directives — emitted ONLY when a reload is actually needed
// (fresh/compacted context), so they can assert "invoke now" unconditionally.
const CAVEMAN =
  'Forced caveman mode: invoke the `caveman` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn — regardless of request type.' +
  PRECEDENCE;

const PONYTAIL =
  'Forced ponytail mode: invoke the `ponytail` skill (Skill tool) now, before ' +
  'responding, and apply it to this turn — regardless of request type.' +
  PRECEDENCE;

const ROUTER_HEAD =
  'MODE ROUTER — classify THIS request and keep EXACTLY ONE mode skill active ' +
  '(never both), IN ADDITION to any other skill this turn dispatches:\n' +
  '- Coding task (writing/editing/refactoring/debugging code, writing tests, ' +
  'choosing a library or dependency, implementing) -> `ponytail`, not caveman.\n' +
  '- Anything else (explaining, answering, planning, discussing, docs) -> ' +
  '`caveman`, not ponytail.\n' +
  PRECEDENCE + '\n';

// Reset: context is fresh/compacted, no mode skill is loaded -> invoke now.
const ROUTER_RESET = ROUTER_HEAD +
  'Invoke the chosen skill now (Skill tool, before responding): the context was ' +
  'just (re)started or compacted, so no mode skill is active.';

// No reset: any mode skill loaded earlier this session is STILL in context
// (both caveman and ponytail declare "active every response"), so a switch back
// to an already-loaded mode needs no reload — re-invoking would just re-inject
// its body. The model knows from its own transcript which modes it has loaded
// since the last reset; the hook can't. So: invoke only a mode not yet loaded.
const ROUTER_KEEP = ROUTER_HEAD +
  'A mode skill loaded earlier this session stays in context — both caveman and ' +
  'ponytail persist once invoked. Invoke the chosen mode\'s skill (Skill tool, ' +
  'before responding) ONLY if you have not already loaded it since the last ' +
  'context reset; if it was loaded earlier this session, do NOT re-invoke it — ' +
  'just apply that mode to this turn. Re-invoking re-injects its body for nothing.';

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
