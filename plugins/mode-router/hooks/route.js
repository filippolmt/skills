#!/usr/bin/env node
// mode-router — one script, five hook events.
//
// The mode skills (caveman/ponytail) declare themselves "active every response",
// and a skill cannot be unloaded. So the only way to guarantee ONE mode per
// context is to stop the second one from ever entering it. That is what this hook
// does, and the LOADED-MODE SET is what makes it decidable:
//
//   SessionStart        (startup|clear|compact|fork)  clears the set — a context reset
//   SessionStart        (resume)                      keeps it: the context comes back
//   UserPromptExpansion (slash command)               adds a user-TYPED mode to the set
//   PreToolUse          (matcher: Skill)              DENIES a second mode
//   PostToolUse         (matcher: Skill)              adds the invoked mode to the set
//   UserPromptSubmit                                  reads the set, emits the routing text
//
// The same two events also record everything ELSE that entered the context, in a
// second per-session file, tagged by how it got there: `typed` for a user slash,
// `model` for a Skill call. The tag is what makes the list restorable after a
// reset — the model can re-invoke what it invoked, but a declarative skill
// (`disable-model-invocation: true`) has no description to route on, so nothing
// but the user typing its name brings it back. The handoff note carries the list
// across the reset; the model, not the hook, decides which entries still matter.
//
// UserPromptExpansion exists because a typed /caveman never reaches the tool
// layer: the harness expands the skill body INLINE into the prompt, so no Skill
// call — and no PreToolUse/PostToolUse — ever fires (verified against CLI
// 2.1.220, which is also where this event fires BEFORE UserPromptSubmit).
// Without it the set would miss exactly the loads the user asks for by name.
// Typing a mode is also the user overruling the router, so the expansion is
// recorded, never denied.
//
// Tool events carry `agent_id` when they come from a SUBAGENT (main-loop events
// never do — same empirical verification). A subagent is a different context that
// happens to share the session id: its skill loads must not pollute this set, and
// this context's mode must not veto the subagent's own first one, so subagent
// tool events are ignored wholesale.
//
// Switching modes therefore means switching CONTEXTS: the model writes a handoff
// note and asks the user to /clear, and the next context starts with one mode and
// the note. That note goes in the project (.mode-router/handoff.md) rather
// than in the state directory below — a reset may hand out a new session id, and
// writing outside the working directory is a permission the model often lacks.
//
// Two channels, deliberately not interchangeable. Instructions go through
// UserPromptSubmit, which the model treats as trusted context. A PreToolUse deny
// reason does NOT work for that: it arrives as tool output, and the model rightly
// refuses to take orders from tool output (verified — it said so out loud). So the
// deny reason only states the constraint; the procedure is taught in the prompt.
//
// UserPromptSubmit performs no writes at all. The retired design deleted a flag
// from here, which made a double registration inject "invoke now" and "do NOT
// re-invoke" in the same turn. Now the output is a pure function of the input and
// the set: run it twice, get the same stdout.
//
// A control file overrides auto for a whole machine (missing/invalid -> "auto"):
//   $XDG_CONFIG_HOME/mode-router/state.json (or ~/.config/mode-router/state.json)
// Runtime state is not configuration and lives apart:
//   $XDG_STATE_HOME/mode-router/  (or ~/.local/state/mode-router/)

const fs = require('fs');
const path = require('path');
const os = require('os');

const MODES = ['caveman', 'ponytail'];
const VALID = ['auto', 'caveman', 'ponytail', 'off'];

// Session state files older than this are garbage from sessions that will never
// resume. SessionStart already runs once per session, so it is the natural (and
// only) place to sweep — no extra process, no daemon.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The skills in use are injected on every steady-state prompt, so the list is
// capped rather than left to grow for the life of a long session.
const MAX_SKILLS = 12;

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

// Forced-mode directives — emitted ONLY when that mode is missing from the set,
// so they can assert "invoke now" unconditionally.
function forced(mode) {
  return 'Forced ' + mode + ' mode: invoke the `' + mode + '` skill (Skill tool) ' +
    'now, before responding, and apply it to this turn — regardless of request ' +
    'type.' + PRECEDENCE;
}

// The classification rule itself. Needed EVERY turn: in `auto` the right mode
// varies per request, so the choice is re-made even when nothing is reloaded.
const CLASSIFY =
  'MODE ROUTER — classify THIS request and keep EXACTLY ONE mode skill active ' +
  '(never both), IN ADDITION to any other skill this turn dispatches:\n' +
  '- Coding task (writing/editing/refactoring/debugging code, writing tests, ' +
  'choosing a library or dependency, implementing) -> `ponytail`, not caveman.\n' +
  '- Anything else (explaining, answering, planning, discussing, docs) -> ' +
  '`caveman`, not ponytail.';

// Emitted once per context, when the set is empty: nothing is loaded, so the
// full rules go in. Later turns get the short form — PRECEDENCE is still in the
// transcript above and repeating it costs ~330 tokens a turn for nothing.
const RESET_TAIL =
  '\n' + PRECEDENCE + '\n' +
  'Invoke the chosen skill now (Skill tool, before responding): no mode skill is ' +
  'in this context.';

function stateDir() {
  return process.env.XDG_STATE_HOME
    ? path.join(process.env.XDG_STATE_HOME, 'mode-router')
    : path.join(os.homedir(), '.local', 'state', 'mode-router');
}

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

const slug = (s) => String(s || 'default').replace(/[^\w.-]/g, '_');

// One file per session, holding the loaded-mode set.
const loadedModesFile = (sessionId) => path.join(stateDir(), `session-${slug(sessionId)}.json`);
// The skills in use live in a SEPARATE file, not a second key in the one above.
// Both are read-modify-write with no lock, so sharing a document would let a
// racing skill write stomp the mode set with its own stale copy — and a lost mode
// disarms the veto, which is the one invariant this hook exists to hold. Split
// files can still lose an add, never a mode. It also keeps the v0.5 state file
// forward-compatible: no `skills` key to miss, the file is simply absent.
const skillsFile = (sessionId) => path.join(stateDir(), `session-${slug(sessionId)}.skills.json`);
// Inside the project, and NOT under .claude/. A reset may hand out a new session
// id while the project stays the same, so the note cannot be keyed by session —
// and the path has to be one the model can actually write. Both alternatives were
// tried and refused even with edits allowed: a target under $XDG_STATE_HOME
// (outside the working directory) and one under .claude/ (protected, reasonably —
// hooks live there). A plain dot-directory in the project writes fine.
const handoffFile = (cwd) => path.join(cwd || '.', '.mode-router', 'handoff.md');

function readJson(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && typeof s === 'object') return s;
  } catch (e) { /* missing / unreadable / invalid -> empty */ }
  return {};
}

function readLoadedModes(sessionId) {
  const s = readJson(loadedModesFile(sessionId));
  return Array.isArray(s.modes) ? MODES.filter((m) => s.modes.includes(m)) : [];
}

// Entries are `{ name, source }`; anything malformed is dropped rather than
// propagated into the handoff text.
function readSkills(sessionId) {
  const s = readJson(skillsFile(sessionId));
  if (!Array.isArray(s.skills)) return [];
  return s.skills.filter((e) => e && typeof e.name === 'string' &&
    (e.source === 'typed' || e.source === 'model'));
}

// Write via rename: a reader never observes a half-written file, and two writes
// racing in the same turn can lose an add but never corrupt the file.
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function addMode(sessionId, mode) {
  const loaded = readLoadedModes(sessionId);
  if (loaded.includes(mode)) return;
  try { writeJson(loadedModesFile(sessionId), { modes: loaded.concat(mode) }); } catch (e) { /* best effort */ }
}

// Modes are excluded: the set above already tracks them, and the handoff would
// name them twice. Stored under the name as it arrived (namespaced or bare) —
// that is the form the user re-types or the model re-invokes — but deduplicated
// on the LAST segment, so a `/grilling` typed and a `grilling:grilling` invoked
// are one entry instead of the same skill listed under two contradictory
// sources. First arrival wins the tag.
function addSkill(sessionId, skill, source) {
  if (typeof skill !== 'string') return;
  const name = skill.trim();
  if (!name || skillToMode(name)) return;
  const skills = readSkills(sessionId);
  if (skills.some((e) => leaf(e.name) === leaf(name))) return;
  // The list is injected on every steady-state prompt, so it cannot grow without
  // bound. Oldest out first: a long session's earliest skills are the least
  // likely to still be shaping the work being handed off.
  try {
    writeJson(skillsFile(sessionId), { skills: skills.concat({ name, source }).slice(-MAX_SKILLS) });
  } catch (e) { /* best effort */ }
}

// `tool_input.skill` is bare (`caveman`) or namespaced (`plugin:caveman`,
// `caveman:caveman`), so compare the LAST segment. Plain endsWith would also
// match a hypothetical `anti-caveman`.
const leaf = (s) => String(s).trim().toLowerCase().split(/[:/]/).pop();

function skillToMode(skill) {
  if (typeof skill !== 'string') return null;
  const l = leaf(skill);
  return MODES.includes(l) ? l : null;
}

// Sweep stale session state, plus the `reload-<id>` files the flag-based design
// used to drop straight into the CONFIG directory alongside state.json.
function sweep(keep) {
  // Handoff notes are deliberately NOT swept: they live in the user's project and
  // hold unfinished work, so removing one is the model's job once it has taken it
  // over, never a timer's. Ditto `keep` — the CURRENT session's two state files:
  // a resume can arrive after any amount of time, so they are never garbage.
  const cutoff = Date.now() - TTL_MS;
  try {
    for (const name of fs.readdirSync(stateDir())) {
      const p = path.join(stateDir(), name);
      if (keep.includes(p)) continue;
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p);
      } catch (e) { /* vanished mid-sweep */ }
    }
  } catch (e) { /* directory not created yet */ }
  try {
    for (const name of fs.readdirSync(configDir())) {
      if (name.startsWith('reload-')) {
        try { fs.unlinkSync(path.join(configDir(), name)); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* no config dir */ }
}

// All five events carry `session_id`, `hook_event_name` and `cwd`.
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

// Both tool branches apply the same two filters. Only the built-in Skill tool
// carries a skill — the matcher narrows this already, but a regex matcher also
// matches tool names merely CONTAINING "Skill". And a tool event from a subagent
// (`agent_id` set) describes a DIFFERENT context that shares the session id:
// ignored both ways — no set pollution from its skill loads, no vetoing its own
// first mode with this context's one.
const skillEventHere = input.tool_name === 'Skill' && !input.agent_id;

// SessionStart: a context reset, EXCEPT on resume. Resume rebuilds the context
// from the transcript, so any mode skill invoked before is back in it and the set
// is still accurate — clearing it there would drop a mode that is actually loaded
// and re-invoke it for nothing. `fork` needs no special case: it gets a new
// session_id, so its set starts empty anyway. Sweeping runs on every source.
if (input.hook_event_name === 'SessionStart') {
  if (input.source !== 'resume') {
    for (const f of [loadedModesFile(input.session_id), skillsFile(input.session_id)]) {
      try { fs.unlinkSync(f); } catch (e) { /* nothing to clear */ }
    }
  }
  sweep([loadedModesFile(input.session_id), skillsFile(input.session_id)]);
  process.exit(0);
}

// UserPromptExpansion: a user-typed /caveman|/ponytail. The harness expands the
// skill body inline — no Skill call ever fires — so this is the only event that
// sees a typed mode enter the context. Recorded, never denied: a deliberate
// choice by the user outranks the router, and once it is in the set a later
// Skill call for it (if one ever happens) reads as a plain re-invoke.
// Every other typed slash is recorded too: this is the ONLY event a declarative
// skill ever fires, so it is the only chance to learn that it is in the context.
if (input.hook_event_name === 'UserPromptExpansion') {
  const mode = skillToMode(input.command_name);
  if (mode) addMode(input.session_id, mode);
  else addSkill(input.session_id, input.command_name, 'typed');
  process.exit(0);
}

// --- PreToolUse: the veto. One mode per context, enforced rather than requested.
if (input.hook_event_name === 'PreToolUse') {
  const mode = skillEventHere ? skillToMode(input.tool_input && input.tool_input.skill) : null;
  const loaded = mode ? readLoadedModes(input.session_id) : [];
  const other = mode ? MODES.find((m) => m !== mode) : null;

  // Deny only the case that actually pollutes: a mode entering a context that
  // already holds the other one. Everything else — non-mode skills, a re-invoke
  // of what is already loaded, a first mode, `off`, or a standing forced
  // choice — goes through untouched.
  let allowed = true;
  if (mode && !loaded.includes(mode) && loaded.includes(other)) {
    const cfg = readMode();
    allowed = cfg === 'off' || cfg === mode;
  }

  if (!allowed) {
    // Purely descriptive. The model does not act on instructions coming from tool
    // output, so the procedure lives in the UserPromptSubmit text instead.
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'mode-router: `' + other + '` is already loaded in this context, and a ' +
          'context holds at most one mode skill, so `' + mode + '` was not loaded. ' +
          'Switching modes means switching contexts.',
      },
    }));
  }
  process.exit(0);
}

// PostToolUse on Skill: a skill the MODEL invoked just entered the context — a
// mode goes in the set, anything else in the skill list.
if (input.hook_event_name === 'PostToolUse') {
  if (skillEventHere) {
    const skill = input.tool_input && input.tool_input.skill;
    const mode = skillToMode(skill);
    if (mode) addMode(input.session_id, mode);
    else addSkill(input.session_id, skill, 'model');
  }
  process.exit(0);
}

// --- UserPromptSubmit ---

// In `auto`, an explicit /caveman|/ponytail means the user already picked a mode
// for this turn — UserPromptExpansion has already recorded it in the set — so
// the classifier stays silent instead of second-guessing them.
function slashMode() {
  const p = typeof input.prompt === 'string' ? input.prompt : input.user_prompt;
  if (typeof p !== 'string') return null;
  const t = p.trimStart();
  if (!t.startsWith('/')) return null;
  // Same last-segment rule as tool names: `/anti-caveman` is not `/caveman`.
  const cmd = t.slice(1).split(/\s+/)[0];
  return skillToMode(cmd);
}

const slash = slashMode();

// A skill cannot be unloaded, so if both modes ever do end up in one context —
// a context predating this hook, or one where the veto never ran — exclusivity
// can only be asserted in words. "Apply one, not the other" is too weak: the leak
// is subtle, caveman's compression bleeding into the prose *around* code, so the
// clause denies the suspended mode any influence at all.
function suspendClause(subject) {
  return subject + ' is SUSPENDED for this turn and contributes NOTHING — not ' +
    'even to prose: no compression, no dropped articles, no borrowed phrasing. ' +
    'Its "active every response" instruction does not survive this turn.';
}

const CODING_IS_PURE =
  ' So a coding turn is pure `ponytail`: the explanations and notes around the ' +
  'code read as normal writing, not as `caveman`.';

// What entered this context, injected as a ready-made list so the note copies it
// instead of the model reconstructing it from memory. The two sources differ in
// how the next context gets them back, and neither is filtered here:
//   - `UserPromptExpansion` fires for EVERY slash command, not only skills, so
//     the typed list also holds one-shot actions (/commit, /pr). The hook cannot
//     tell them apart; the model can, and it is the one writing the note.
//   - `typed` does not mean "declarative". It means the model did not invoke it,
//     so it may or may not be re-invocable — only the model knows. What is
//     certain is that a DECLARATIVE skill can arrive no other way, which is why
//     the user is the fallback for this group.
// The re-type line is one slash PER MESSAGE: a message expands only its leading
// slash and swallows the rest as that command's arguments.
function skillsClause(skills) {
  if (!skills.length) return '';
  const named = (s) => skills.filter((e) => e.source === s).map((e) => e.name);
  const typed = named('typed');
  const model = named('model');
  let c = ' Recorded for the note —';
  if (typed.length) {
    c += ' TYPED here: ' + typed.map((n) => '/' + n).join(' ') + ' (slash commands, ' +
      'so one-shot actions are in there too: keep only what still shapes the work, ' +
      'and put the keepers in the note as commands the user re-types after the ' +
      'reset, one per message, before the prompt — a declarative skill has no other ' +
      'way back).';
  }
  if (model.length) {
    c += ' INVOKED here: ' + model.map((n) => '`' + n + '`').join(', ') +
      ' (the next context re-invokes these itself, so just name them).';
  }
  return c;
}

// The switch procedure. Taught here because this channel is trusted; the veto
// only enforces it.
function handoffInstruction(other, cwd, skills) {
  return ' If you classify to `' + other + '`, do NOT invoke it: a context holds ' +
    'at most one mode skill, and the invocation would be denied. Switch contexts ' +
    'instead — write a handoff note to `' + handoffFile(cwd) + '` covering what ' +
    'has been established so far, what still has to be done, the skills still ' +
    'shaping the work, and the exact prompt to send after the reset; then tell ' +
    'the user to run ' +
    '/clear and send that prompt; then stop, without doing the task this turn. ' +
    'Creating the note and saying so IS the whole turn.' + skillsClause(skills) +
    ' If writing that file is not possible (plan mode, ' +
    'restricted permissions), put the same handoff inline in your reply instead — ' +
    'the point is that nothing is lost across the reset, not the file itself.';
}

function invocationTail(loaded, cwd, skills) {
  if (loaded.length === 0) {
    let tail = RESET_TAIL;
    // A handoff outlives the clear that consumed the context which wrote it.
    const note = handoffFile(cwd);
    try {
      if (fs.statSync(note).isFile()) {
        tail += ' A handoff note left before the last reset is waiting at `' +
          note + '`: read it first, continue the work it describes, ' +
          'and delete the file once you have taken it over. If it names skills, ' +
          're-invoke the ones you can reach (Skill tool) and ask the user to ' +
          're-type the rest before you continue.';
      }
    } catch (e) { /* no pending handoff */ }
    return tail;
  }
  if (loaded.length === 1) {
    const other = MODES.find((m) => m !== loaded[0]);
    return '\n`' + loaded[0] + '` is already in this context: if you classify to ' +
      'it, do NOT re-invoke — just apply it.' + handoffInstruction(other, cwd, skills);
  }
  return '\nBoth `caveman` and `ponytail` are already in this context — invoke ' +
    'neither. Apply ONLY the mode you classify to; ' +
    suspendClause('the other one') + CODING_IS_PURE;
}

const mode = readMode();
const loaded = readLoadedModes(input.session_id);

const out =
  mode === 'off' ? '' :
  // Forced modes: invoke when missing from the set, stay silent once it is in.
  mode === 'caveman' || mode === 'ponytail'
    ? (loaded.includes(mode) ? '' : forced(mode)) :
  // auto: always classify; the set decides what to say about invoking.
  slash ? '' :
  CLASSIFY + invocationTail(loaded, input.cwd, readSkills(input.session_id));

if (out) process.stdout.write(out);
process.exit(0);
