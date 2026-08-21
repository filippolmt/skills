#!/usr/bin/env node
// mode-router — one script, four hook events.
//
// The mode skills (caveman/ponytail) declare themselves "active every response",
// and a skill cannot be unloaded. So exclusivity cannot be one mode per CONTEXT;
// it is one mode per TURN: the injected text applies the mode this request
// classifies to and SUSPENDS the other one for the turn. The LOADED-MODE SET is
// what makes the rest decidable — it says what is already here, and therefore
// what still has to be invoked:
//
//   SessionStart        (startup|clear|compact|fork)  clears the set — a context reset
//   SessionStart        (resume)                      keeps it: the context comes back
//   UserPromptExpansion (slash command)               adds a user-TYPED mode to the set
//   PostToolUse         (matcher: Skill)              adds the invoked mode to the set
//   UserPromptSubmit                                  reads the set, emits the routing text
//
// One rule holds the design: the SET decides what to INVOKE, the SUSPENSION
// decides who SPEAKS. Hence two branches in invocationTail() and not three —
// with one mode loaded or with both, the model answers with every body that is
// in the context, so the only difference is whether an invocation is still being
// asked for.
//
// A PreToolUse branch used to DENY a second mode entering the context (0.5.0 to
// 0.7.0), which made switching mode mean switching contexts. Removed in 0.8.0:
// the leak it guarded was measured and does not happen, and it cost ~62% of the
// text injected on every steady-state turn — docs/adr/0001-drop-the-skill-veto.md
// carries the numbers. Two things to know before adding any event back here: the
// registration in hooks.json is half the change (an event registered but not
// handled falls through to the UserPromptSubmit tail), and the guard below the
// PostToolUse branch is what stops that fall-through.
//
// The two set-feeding events also record everything ELSE that entered the
// context, in a second per-session file, tagged by how it got there: `typed` for
// a user slash, `model` for a Skill call. The tag is what makes the list
// restorable after a reset — the model can re-invoke what it invoked, but a
// declarative skill (`disable-model-invocation: true`) has no description to
// route on, so nothing but the user typing its name brings it back. The list is
// emitted on the /handoff turn, not every turn; the model, not the hook, decides
// which entries still matter.
//
// UserPromptExpansion exists because a typed /caveman never reaches the tool
// layer: the harness expands the skill body INLINE into the prompt, so no Skill
// call — and no PostToolUse — ever fires (verified against CLI 2.1.220 and
// re-confirmed on 2.1.237, which is also where this event fires BEFORE
// UserPromptSubmit). Without it the set would miss exactly the loads the user
// asks for by name.
//
// Tool events carry `agent_id` when they come from a SUBAGENT (main-loop events
// never do — same empirical verification). A subagent is a different context that
// happens to share the session id, so its skill loads must not pollute this set:
// subagent tool events are ignored wholesale.
//
// Switching mode no longer requires switching contexts, so this hook no longer
// asks for a handoff note. The /clear between planning and implementation stays
// as something the USER wants, and the note that carries work across it is
// written on demand by the /handoff command (commands/handoff.md). The split is
// forced by one fact: the model does not know its own session id, so it cannot
// find the skills file by name — the command carries the static schema, the hook
// contributes the list and stays silent about routing that turn. See
// docs/adr/0002-handoff-note-as-typed-command.md.
//
// This hook keeps only the READ side of the note: it lives in the project
// (.mode-router/handoff.md) rather than in the state directory below — a reset
// may hand out a new session id, and writing outside the working directory is a
// permission the model often lacks — and the empty-set branch announces it to the
// fresh context. Its presence IS its state: pending while the file is there,
// absorbed once the model deletes it — no status field to keep in sync.
//
// The model owns that deletion, because only it knows when it has taken the note
// over. The hook is the backstop for when it forgets: past 24h the note is no
// longer SERVED as current, and SessionStart ARCHIVES it to
// .mode-router/handoff-<stamp>.md. Archiving cannot live in UserPromptSubmit —
// that branch writes nothing, by the rule below — and SessionStart non-resume is
// both the only other event that already writes and the exact moment a stale note
// becomes dangerous: a fresh context is about to be told what is pending.
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
// The command that writes the handoff note (commands/handoff.md). Named here
// because two places need it: the turn it is typed on, and the skill list it must
// stay out of.
const HANDOFF_COMMAND = 'handoff';

// Session state files older than this are garbage from sessions that will never
// resume. SessionStart already runs once per session, so it is the natural (and
// only) place to sweep — no extra process, no daemon.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A handoff note is served to a fresh context as work in progress, so it has a
// far shorter shelf life than session state: a day out, it is likelier one the
// model forgot to delete than one still waiting to be picked up.
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

// The list is emitted once, on the /handoff turn, so growing it no longer costs a
// per-turn injection. The cap survives for the note's sake: it has a ~30-line
// budget, and a `## Skills` block naming forty names is one nobody re-types. In a
// long session the earliest skills are also the least likely to still be shaping
// the work being handed off.
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
// racing skill write stomp the mode set with its own stale copy. A lost mode is no
// longer a broken invariant — it costs one redundant invocation of a mode already
// in the context, which the harness deduplicates anyway — but the set is what
// every turn's text is computed from, so it is the half worth protecting. Split
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
// Where a note goes when the backstop fires. Keyed by the note's own mtime, not
// by "now": the name then says when the work inside it was last touched, and
// archiving the same note twice is impossible anyway — the first rename moves it.
const handoffArchive = (cwd, mtimeMs) => path.join(cwd || '.', '.mode-router',
  'handoff-' + new Date(mtimeMs).toISOString().replace(/[:.]/g, '-') + '.md');

// The note's mtime, or null when there is no note. Callers compare it against
// HANDOFF_TTL_MS: the file existing is not enough, it has to be current.
function handoffMtime(cwd) {
  try {
    const st = fs.statSync(handoffFile(cwd));
    return st.isFile() ? st.mtimeMs : null;
  } catch (e) { return null; }
}

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
  // `/handoff` is excluded for the same reason the modes are: it is the command
  // that WRITES the note, so filing it would make the note cite itself.
  if (!name || skillToMode(name) || leaf(name) === HANDOFF_COMMAND) return;
  const skills = readSkills(sessionId);
  if (skills.some((e) => leaf(e.name) === leaf(name))) return;
  // Capped for the note's line budget, not for a per-turn cost. Oldest out first,
  // for the reason given at MAX_SKILLS.
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
  // over, never a timer's. Their archives are not swept either — this loop only
  // reads stateDir() and configDir(), never the project, so both are out of reach
  // by construction rather than by a filter. Ditto `keep` — the CURRENT
  // session's two state files:
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

// The backstop half of the note's two-level expiry. The model is the primary
// owner and deletes the note once it has absorbed it; this catches the notes it
// forgot. Archiving rather than deleting: it is the user's unfinished work, so it
// moves aside and stays readable. Nothing prunes the archives — they cost disk in
// an already-gitignored directory, and deleting the user's work on a timer is the
// thing this whole mechanism exists to avoid.
function archiveStaleHandoff(cwd) {
  const mtime = handoffMtime(cwd);
  if (mtime === null || Date.now() - mtime <= HANDOFF_TTL_MS) return;
  try {
    fs.renameSync(handoffFile(cwd), handoffArchive(cwd, mtime));
  } catch (e) { /* vanished, or the project directory is not writable */ }
}

// All five events carry `session_id`, `hook_event_name` and `cwd`.
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8')) || {}; } catch (e) { /* no stdin */ }

// Two filters on the one tool branch left. Only the built-in Skill tool carries a
// skill — the matcher narrows this already, but a regex matcher also matches tool
// names merely CONTAINING "Skill". And a tool event from a subagent (`agent_id`
// set) describes a DIFFERENT context that happens to share the session id, so its
// skill loads must not enter this set.
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
    // Only on a real reset: a resume walks back into the context that wrote the
    // note, where it is not a leftover but the work in hand.
    archiveStaleHandoff(input.cwd);
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

// Everything below belongs to this one event, and now says so. Each branch above
// exits, so before 0.8.0 the tail was reachable only by convention — an event
// registered in hooks.json but not handled here fell straight through and printed
// routing text on, say, every `Skill` call. Removing the veto's branch made that
// one line of distance between working and broken; the guard closes it for good.
if (input.hook_event_name !== 'UserPromptSubmit') process.exit(0);

// The leading slash command of this prompt, or null when there is none. Only the
// leading one: a message expands its first slash and swallows the rest as that
// command's arguments.
function slashCommand() {
  const p = typeof input.prompt === 'string' ? input.prompt : input.user_prompt;
  if (typeof p !== 'string') return null;
  const t = p.trimStart();
  if (!t.startsWith('/')) return null;
  return t.slice(1).split(/\s+/)[0];
}

const slash = slashCommand();
// An explicit /caveman|/ponytail means the user already picked a mode for this
// turn — UserPromptExpansion has already recorded it in the set — so the
// classifier stays silent instead of second-guessing them. Last-segment rule, as
// for tool names: `/anti-caveman` is not `/caveman`.
const slashIsMode = skillToMode(slash) !== null;
// `/handoff` writes the note, and the note has an imposed shape and no prose to
// style: a mode there could only argue with the schema. So the turn gets the one
// half commands/handoff.md cannot carry — the skill list, keyed by a session id
// the model does not know — and nothing about routing.
const handoffTurn = slash !== null && leaf(slash) === HANDOFF_COMMAND;

// A skill cannot be unloaded, and nothing stops the second mode from entering any
// more, so a context holding both is the normal steady state of a long session and
// exclusivity can only be asserted in words. These are the words that were
// measured (ADR-0001): "apply one, not the other" leaves room for the leak the
// clause exists for — caveman's compression bleeding into the prose *around* code
// — so it denies the suspended mode any influence at all. Wording in here has
// measurable and counter-intuitive effects; it is not rephrased casually.
function suspendClause(subject) {
  return subject + ' is SUSPENDED for this turn and contributes NOTHING — not ' +
    'even to prose: no compression, no dropped articles, no borrowed phrasing. ' +
    'Its "active every response" instruction does not survive this turn.';
}

const CODING_IS_PURE =
  ' So a coding turn is pure `ponytail`: the explanations and notes around the ' +
  'code read as normal writing, not as `caveman`.';

// What entered this context, emitted on the /handoff turn as a ready-made list so
// the note copies it instead of the model reconstructing it from memory. It is the
// whole output of that turn, so it opens the text rather than continuing a
// sentence. The two sources differ in how the next context gets them back, and
// neither is filtered here:
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
  let c = 'Recorded for the note —';
  if (typed.length) {
    c += ' TYPED here: ' + typed.map((n) => '/' + n).join(' ') + ' (slash commands, ' +
      'so one-shot actions are in there too: keep only what still shapes the work, ' +
      'and put the keepers in `## Skills` as commands the user re-types, one per ' +
      'message, before the prompt — a declarative skill has no other way back).';
  }
  if (model.length) {
    c += ' INVOKED here: ' + model.map((n) => '`' + n + '`').join(', ') +
      ' (the next context re-invokes these itself, so just name them).';
  }
  return c;
}

// The mode not classified to is inert for the turn, whichever way the
// classification went, so both shapes of the non-empty branch end the same way:
// with one mode loaded "the other one" is whichever of the two the turn did not
// pick, with both loaded it is the one left sitting in the context unused.
const SUSPEND_TAIL = ' Apply ONLY the mode you classify to; ' +
  suspendClause('the other one') + CODING_IS_PURE;

function invocationTail(loaded, cwd) {
  if (loaded.length === 0) {
    let tail = RESET_TAIL;
    // A handoff outlives the clear that consumed the context which wrote it —
    // but only for a day. Past the TTL it is likelier a note the model forgot to
    // delete than work still waiting, so it is not offered as current: the read
    // half of the two-level expiry. Retiring it is SessionStart's job, because
    // this branch performs no writes at all.
    const mtime = handoffMtime(cwd);
    if (mtime !== null && Date.now() - mtime <= HANDOFF_TTL_MS) {
      tail += ' A handoff note left before the last reset is waiting at `' +
        handoffFile(cwd) + '`: read it first, continue the work it describes, ' +
        'and delete the file once you have taken it over. If it names skills, ' +
        're-invoke the ones you can reach (Skill tool) and ask the user to ' +
        're-type the rest before you continue.';
    }
    return tail;
  }
  // Non-empty. The set decides invoke from do-not-re-invoke and nothing else, so
  // one loaded mode and two are the same state to answer in — the only difference
  // is whether an invocation is still being asked for.
  const missing = MODES.find((m) => !loaded.includes(m));
  if (!missing) {
    return '\nBoth `caveman` and `ponytail` are already in this context — invoke ' +
      'neither.' + SUSPEND_TAIL;
  }
  return '\n`' + loaded[0] + '` is already in this context: if you classify to it, ' +
    'do NOT re-invoke — just apply it; if you classify to `' + missing + '`, ' +
    'invoke it now (Skill tool, before responding).' + SUSPEND_TAIL;
}

const mode = readMode();
const loaded = readLoadedModes(input.session_id);

const out =
  mode === 'off' ? '' :
  // Ahead of the mode cases, forced ones included: what this turn needs is the
  // note's missing half, not a style for prose the note does not contain. Only
  // `off` outranks it, that being a standing instruction to inject nothing.
  handoffTurn ? skillsClause(readSkills(input.session_id)) :
  // Forced modes: invoke when missing from the set, stay silent once it is in.
  mode === 'caveman' || mode === 'ponytail'
    ? (loaded.includes(mode) ? '' : forced(mode)) :
  // auto: always classify; the set decides what to say about invoking.
  slashIsMode ? '' :
  CLASSIFY + invocationTail(loaded, input.cwd);

if (out) process.stdout.write(out);
process.exit(0);
