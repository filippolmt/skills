#!/usr/bin/env node
// mode-router — one script, five hook events.
//
// The mode skills (caveman/ponytail) declare themselves "active every response",
// and a skill cannot be unloaded. So a context holds ONE mode: the first one that
// enters it. The router never brings the second one in — a request that
// classifies the other way is a MODE SWITCH, and the turn answers with a one-line
// notice recommending /carryover + /clear instead of loading the other mode. The
// LOADED-MODE SET is what makes that decidable — it says what is already here:
//
//   SessionStart        (startup|clear|compact|fork)  clears the set — a context reset
//   SessionStart        (resume)                      keeps it: the context comes back
//   UserPromptExpansion (slash command)               adds a user-TYPED mode to the set,
//                                                     or marks a note as this session's
//   PreToolUse          (matcher: Skill)              the VETO: denies a mode entering a
//                                                     context that holds the other one
//   PostToolUse         (matcher: Skill)              adds the invoked mode to the set
//   UserPromptSubmit                                  reads the set, emits the routing text
//
// The veto is the net, not the mechanism: the routing text tells the model not to
// invoke, and PreToolUse catches the call it makes anyway. A typed /caveman never
// reaches the tool layer (see UserPromptExpansion below), so the one way a MIXED
// context — both modes loaded — still arises is the user typing the second mode.
// That is a choice of theirs, recorded and not fought: from then on the turn
// applies the mode it classifies to and SUSPENDS the other one, in words.
//
// Why the veto left in 0.8.0 and came back in 0.10.0 is ADR-0001 and ADR-0006
// (docs/adr/, marketplace root); ROUTING.md "History" has the short form.
//
// Two things to know about the events: the registration in hooks.json is half the
// change (an event registered but not handled falls through to the
// UserPromptSubmit tail), and the guard below the PostToolUse branch is what stops
// that fall-through.
//
// The two set-feeding events also record everything ELSE that entered the
// context, in a second per-session file, tagged by how it got there: `typed` for
// a user slash, `model` for a Skill call. The tag is what makes the list
// restorable after a reset — the model can re-invoke what it invoked, but a
// declarative skill (`disable-model-invocation: true`) has no description to
// route on, so nothing but the user typing its name brings it back. The list is
// emitted on the /carryover turn, not every turn; the model, not the hook, decides
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
// The hook RECOMMENDS the /carryover + /clear on a mode switch and never demands
// it: the user may answer "proceed" and get the turn answered with no mode at
// all. The note that carries work across the clear is written on demand by the
// /carryover command (commands/carryover.md). The split is
// forced by one fact: the model does not know its own session id, so it cannot
// find the skills file by name — the command carries the static schema, the hook
// contributes the list and stays silent about routing that turn. The note's
// RESOLVED path travels the same way and for the same reason: a file can only
// carry a relative one, and a session that did not start at the project root would
// then write where nothing reads. See docs/adr/0002-handoff-note-as-typed-command.md.
//
// The command is `/carryover`, not `/handoff`: the note keeps the domain name,
// the command does not. Through 0.8.0 it was `/handoff` and collided with an
// unrelated `handoff` skill this marketplace also ships — one leaf name, two
// bodies, and `claude plugin validate` blind to it. See
// docs/adr/0004-rename-the-handoff-command.md.
//
// This hook keeps only the READ side of the note: it lives in the project
// (.mode-router/handoff.md) rather than in the state directory below — a reset
// may hand out a new session id, and writing outside the working directory is a
// permission the model often lacks — and the empty-set branch announces it to a
// fresh context, but never back to the session that wrote it (noteWrittenFile).
// Its presence IS its state: pending while the file is there, absorbed once the
// model deletes it — no status field to keep in sync.
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
// The command that writes the handoff note (commands/carryover.md). Two places need
// it: the turn it is typed on, and the skill list it must stay out of. The name
// comes from the FILENAME — a command file carries no `name` frontmatter — so
// renaming the file is what renames the command, and this constant has to follow.
const CARRYOVER_COMMAND = 'carryover';
const PLUGIN = 'mode-router';

// Session state files older than this are garbage from sessions that will never
// resume. SessionStart already runs once per session, so it is the natural (and
// only) place to sweep — no extra process, no daemon.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A handoff note is served to a fresh context as work in progress, so it has a
// far shorter shelf life than session state: a day out, it is likelier one the
// model forgot to delete than one still waiting to be picked up.
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

// The list is emitted once, on the /carryover turn, so growing it no longer costs a
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

// This session asked for a note. It exists so the announcement below can ask the
// question it actually means: "did somebody ELSE leave this for me?" An empty mode
// set was standing in for that, and is not the same thing — a session where no
// mode has loaded yet has one too, and the carryover turn is precisely such a
// turn, since the hook invokes no mode there. Cleared by the same reset that
// clears the rest of the session state, which is where "else" comes from.
//
// Its MTIME is the payload, not its contents: the marker is dropped when the
// command is typed, so any note this session went on to write is newer than it.
// That ordering makes it qualify the NOTE rather than the whole session — a note
// already sitting there when the command was typed is older, so it stays somebody
// else's and keeps being announced, and typing the command without writing
// anything suppresses nothing. Written once per session for the same reason: a
// second write would move the mtime past a note already written here and hand it
// back to its own author.
const noteWrittenFile = (sessionId) => path.join(stateDir(), `session-${slug(sessionId)}.wrote-note`);
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

// Ours only if the note is at least as new as the marker. No marker at all (the
// usual case) means the note came from somewhere else.
function wroteThisNote(sessionId, noteMtime) {
  try { return noteMtime >= fs.statSync(noteWrittenFile(sessionId)).mtimeMs; }
  catch (e) { return false; }
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
// propagated into the note.
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

// Modes are excluded: the set above already tracks them, and the note would name
// them twice. Stored under the name as it arrived (namespaced or bare) —
// that is the form the user re-types or the model re-invokes — but deduplicated
// on the LAST segment, so a `/grilling` typed and a `grilling:grilling` invoked
// are one entry instead of the same skill listed under two contradictory
// sources. First arrival wins the tag.
function addSkill(sessionId, skill, source) {
  if (typeof skill !== 'string') return;
  const name = skill.trim();
  // `/carryover` is excluded for the same reason the modes are: it is the command
  // that WRITES the note, so filing it would make the note cite itself. Any other
  // skill is ordinary and gets recorded — `handoff` included, which is now a
  // third-party name this plugin no longer shares.
  if (!name || skillToMode(name) || isCarryoverCommand(name)) return;
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

// The FULL namespaced name, and nothing else — not the leaf() rule the modes use,
// and not the bare name either. Both exclusions are measured (ADR-0004):
//
//   leaf()  would capture `X:carryover` for any X, suppressing routing on a turn
//           this plugin has no part in and injecting a list aimed at a note
//           somebody else's command does not write.
//   bare    cannot arrive. The harness exposes plugin commands namespaced only
//           (`mode-router:carryover`), a typed bare form dies as `Unknown command`
//           before UserPromptSubmit fires, and UserPromptExpansion delivers
//           `command_name` namespaced. Every path was measured; none carries it.
//
// Through 0.8.0 this accepted the bare name too, on the reasoning that a bare
// `/handoff` was "irreducibly ambiguous" and so might as well be claimed. It was
// not ambiguous — it resolved to another plugin's skill every time — which is the
// defect ADR-0004 exists for. Accepting a form that cannot arrive is the same
// mistake with the sign flipped: it asserts something about dispatch instead of
// measuring it.
const isCarryoverCommand = (name) => typeof name === 'string' &&
  name.trim().toLowerCase() === PLUGIN + ':' + CARRYOVER_COMMAND;

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
  // session's three state files:
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

// Two filters on the tool branches. Only the built-in Skill tool carries a
// skill — the matcher narrows this already, but a regex matcher also matches tool
// names merely CONTAINING "Skill". And a tool event from a subagent (`agent_id`
// set) describes a DIFFERENT context that happens to share the session id, so its
// skill loads must not enter this set.
const skillEventHere = input.tool_name === 'Skill' && !input.agent_id;
// The skill this tool event names, or null when the event is not one of ours.
const skillOfEvent = () => (skillEventHere && input.tool_input) ? input.tool_input.skill : null;

// SessionStart: a context reset, EXCEPT on resume. Resume rebuilds the context
// from the transcript, so any mode skill invoked before is back in it and the set
// is still accurate — clearing it there would drop a mode that is actually loaded
// and re-invoke it for nothing. `fork` needs no special case: it gets a new
// session_id, so its set starts empty anyway. Sweeping runs on every source.
if (input.hook_event_name === 'SessionStart') {
  if (input.source !== 'resume') {
    for (const f of [loadedModesFile(input.session_id), skillsFile(input.session_id),
                     noteWrittenFile(input.session_id)]) {
      try { fs.unlinkSync(f); } catch (e) { /* nothing to clear */ }
    }
    // Only on a real reset: a resume walks back into the context that wrote the
    // note, where it is not a leftover but the work in hand.
    archiveStaleHandoff(input.cwd);
  }
  sweep([loadedModesFile(input.session_id), skillsFile(input.session_id),
         noteWrittenFile(input.session_id)]);
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
  // The one command whose typing is itself state: what follows it is a note this
  // context wrote, which the announcement below must not hand back to it. The
  // only failure in this file that costs the USER something — losing this write
  // means the next turn is told to delete the note about to be written — so it is
  // the one that does not stay silent.
  // The write-once check is nested rather than folded into this condition: with it
  // in the `else if`, a SECOND /carryover in one session falls through to the
  // `else` and is recorded as an ordinary typed skill — harmless today only
  // because addSkill filters it again, which makes a guard two functions away
  // load-bearing. This branch owns the command outright instead.
  else if (isCarryoverCommand(input.command_name)) {
    if (!fs.existsSync(noteWrittenFile(input.session_id))) {
      try { writeJson(noteWrittenFile(input.session_id), {}); }
      catch (e) {
        process.stderr.write('mode-router: could not mark this session as the note\'s ' +
          'author (' + e.message + '). The next prompt may ask for the note to be ' +
          'deleted — keep it.\n');
      }
    }
  } else addSkill(input.session_id, input.command_name, 'typed');
  process.exit(0);
}

// PreToolUse on Skill: the veto. Denies exactly one thing — a mode skill entering
// a context that already holds the OTHER mode. A non-mode skill, a re-invoke of
// what is loaded and the first mode all pass. So does the control file, in two
// shapes: `off` vetoes nothing, and a FORCED mode may enter a context holding the
// other — the file outranks the set. A forced `caveman` does not let a stray
// `ponytail` call through, though: the only mode the file waves in is its own.
// The reason is descriptive only: the model acts on the UserPromptSubmit text,
// which told it not to make this call in the first place.
if (input.hook_event_name === 'PreToolUse') {
  const mode = skillToMode(skillOfEvent());
  if (mode) {
    const loaded = readLoadedModes(input.session_id);
    const other = MODES.find((m) => m !== mode);
    const cfg = readMode();
    if (!loaded.includes(mode) && loaded.includes(other) && cfg !== 'off' && cfg !== mode) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'mode-router: `' + other + '` is already loaded ' +
            'in this context and a context holds one mode, so `' + mode + '` was ' +
            'not loaded. Answer this turn as the routing text says.',
        },
      }));
    }
  }
  process.exit(0);
}

// PostToolUse on Skill: a skill the MODEL invoked just entered the context — a
// mode goes in the set, anything else in the skill list.
if (input.hook_event_name === 'PostToolUse') {
  const skill = skillOfEvent();
  if (skill) {
    const mode = skillToMode(skill);
    if (mode) addMode(input.session_id, mode);
    else addSkill(input.session_id, skill, 'model');
  }
  process.exit(0);
}

// --- UserPromptSubmit ---

// Everything below belongs to this one event, and says so. Each branch above
// exits, so the tail used to be reachable by convention alone — an event
// registered in hooks.json but not handled here fell straight through and printed
// routing text on, say, every `Skill` call. The guard closes that for good.
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
// `/carryover` writes the note, and the note has an imposed shape and no prose to
// style: a mode there could only argue with the schema. So the turn gets the one
// half commands/carryover.md cannot carry — the skill list, keyed by a session id
// the model does not know — and nothing about routing.
const carryoverTurn = isCarryoverCommand(slash);

// A skill cannot be unloaded. The router keeps the second mode out (the switch
// notice, then the veto), but a user-typed slash brings it in past both, and from
// then on exclusivity can only be asserted in words. These are the words that were
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

// What entered this context, emitted on the /carryover turn so the note copies it
// instead of the model reconstructing it from memory. DATA only, split by how it
// arrived: what to do with each group is static text and lives in
// commands/carryover.md, per ADR-0002 — restating it here would be the same
// instruction maintained in two places, drifting apart on the first edit.
function skillsClause(skills) {
  if (!skills.length) return '';
  const named = (s) => skills.filter((e) => e.source === s).map((e) => e.name);
  const typed = named('typed');
  const model = named('model');
  let c = 'Recorded for the note —';
  if (typed.length) c += ' TYPED here: ' + typed.map((n) => '/' + n).join(' ') + '.';
  if (model.length) c += ' INVOKED here: ' + model.map((n) => '`' + n + '`').join(', ') + '.';
  return c;
}

// Where the note goes, resolved. The command file can only carry a relative path,
// and the read side below resolves it against `cwd`: a session that did not start
// at the project root would write one place and be read another, losing the note
// silently. 0.7.0 injected the resolved path on the writing turn and could not
// drift; so does this.
const handoffTarget = (cwd) => 'Write the note to `' + handoffFile(cwd) +
  '` — that exact path, which is where this hook reads it back from.';

// Mixed context only: the mode not classified to is the one left sitting in the
// context unused, and it is inert for the turn.
const SUSPEND_TAIL = ' Apply ONLY the mode you classify to; ' +
  suspendClause('the other one') + CODING_IS_PURE;

// One mode loaded. The SWITCH CLAUSE is what the model receives; the SWITCH
// NOTICE is the one line the user sees when the request classifies to the missing
// mode. That mode is not invoked. The user decides between the reset the router
// recommends and going on without a mode. "Proceed" is remembered by the model,
// not the hook: UserPromptSubmit is stateless and the word comes in any language,
// so the clause points at the previous message instead of matching keywords.
// Everything after "do NOT invoke it" belongs to that branch alone — a turn
// classified to the loaded mode never sees a notice.
function switchClause(loaded, missing) {
  return '\n`' + loaded + '` is already in this context and a context holds ONE ' +
    'mode. If you classify to `' + loaded + '`: apply it, do NOT re-invoke, answer ' +
    'normally. If you classify to `' + missing + '`: do NOT invoke it; instead — ' +
    'unless the user\'s previous message declined the reset for this same request ' +
    '("proceed" or equivalent) — answer with ONLY this notice, in the user\'s ' +
    'language, and stop: "This is a `' + missing + '` request in a `' + loaded + '` ' +
    'context. Recommended: `/mode-router:carryover`, then `/clear`, then re-send the ' +
    'request. To answer here with no mode, reply: proceed." If they did decline: ' +
    'answer with NO mode at all — plain writing, no `' + loaded + '` rules, no `' +
    missing + '` rules.';
}

function invocationTail(loaded, cwd, sessionId) {
  if (loaded.length === 0) {
    let tail = RESET_TAIL;
    // A note outlives the clear that consumed the context which wrote it —
    // but only for a day. Past the TTL it is likelier a note the model forgot to
    // delete than work still waiting, so it is not offered as current: the read
    // half of the two-level expiry. Retiring it is SessionStart's job, because
    // this branch performs no writes at all.
    const mtime = handoffMtime(cwd);
    if (mtime !== null && !wroteThisNote(sessionId, mtime) &&
        Date.now() - mtime <= HANDOFF_TTL_MS) {
      tail += ' A handoff note left before the last reset is waiting at `' +
        handoffFile(cwd) + '`: read it first, continue the work it describes, ' +
        'and delete the file once you have taken it over. If it names skills, ' +
        're-invoke the ones you can reach (Skill tool) and ask the user to ' +
        're-type the rest before you continue.';
    }
    return tail;
  }
  // Both loaded: a mixed context, reached only by a typed slash. Neither is
  // invoked, and the one not classified to is suspended for the turn.
  const missing = MODES.find((m) => !loaded.includes(m));
  if (!missing) {
    return '\nBoth `caveman` and `ponytail` are already in this context — invoke ' +
      'neither.' + SUSPEND_TAIL;
  }
  // One loaded: apply it or, on a switch, notify instead of invoking the other.
  return switchClause(loaded[0], missing);
}

const mode = readMode();
const loaded = readLoadedModes(input.session_id);

const out =
  mode === 'off' ? '' :
  // Ahead of the mode cases, forced ones included: what this turn needs is the
  // note's missing half, not a style for prose the note does not contain. Only
  // `off` outranks it, that being a standing instruction to inject nothing.
  carryoverTurn
    ? [handoffTarget(input.cwd), skillsClause(readSkills(input.session_id))]
        .filter(Boolean).join(' ') :
  // Forced modes: invoke when missing from the set, stay silent once it is in.
  mode === 'caveman' || mode === 'ponytail'
    ? (loaded.includes(mode) ? '' : forced(mode)) :
  // auto: always classify; the set decides what to say about invoking.
  slashIsMode ? '' :
  CLASSIFY + invocationTail(loaded, input.cwd, input.session_id);

if (out) process.stdout.write(out);
process.exit(0);
