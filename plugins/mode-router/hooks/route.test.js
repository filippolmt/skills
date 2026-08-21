#!/usr/bin/env node
// Self-check for route.js. Run: node route.test.js
// Drives the loaded-mode set, per-turn exclusivity and the handoff hand-over end
// to end via real subprocess runs.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'route.js');
// The static half of the handoff design lives here now, not in a string in the
// hook — but the contract is the same one, so it is checked at its new address.
// The only form that can reach the hook: the harness exposes plugin commands
// namespaced only, and a bare `/carryover` dies as `Unknown command` (ADR-0004).
const CARRYOVER = '/mode-router:carryover';
const CARRYOVER_MD = path.join(__dirname, '..', 'commands', 'carryover.md');
// Isolate BOTH XDG roots: config holds state.json, state holds the loaded-mode
// set. Leaking either would write into the developer's real home.
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-router-cfg-'));
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-router-state-'));
const SID = 'sess-1';
// A real directory: the handoff note lives in the project, so the test has to be
// able to create it where the hook will look for it.
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-router-proj-'));
const HANDOFF = path.join(CWD, '.mode-router', 'handoff.md');

function run(event, payload) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ hook_event_name: event, session_id: SID, cwd: CWD, ...payload }),
    env: { ...process.env, XDG_CONFIG_HOME: CFG, XDG_STATE_HOME: STATE },
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  return r.stdout;
}

const prompt = (p) => run('UserPromptSubmit', { prompt: p });
const loadSkill = (skill) => run('PostToolUse', { tool_name: 'Skill', tool_input: { skill } });
// A user-typed /<name>: the harness expands the skill inline (NO Skill call) and
// reports it through UserPromptExpansion — the flow verified against CLI 2.1.220.
const expand = (name) => run('UserPromptExpansion', {
  expansion_type: 'slash_command', command_name: name, prompt: '/' + name,
});

// Backdate the note and return the archive path the hook will move it to. The
// stamp is read back from the filesystem rather than recomputed: utimes takes
// float seconds, and the expected name has to match the mtime that actually
// landed, not the one requested.
function ageHandoff(ageMs) {
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(HANDOFF, t, t);
  const stamp = new Date(fs.statSync(HANDOFF).mtimeMs).toISOString().replace(/[:.]/g, '-');
  return path.join(CWD, '.mode-router', 'handoff-' + stamp + '.md');
}

function writeHandoff(body) {
  fs.mkdirSync(path.dirname(HANDOFF), { recursive: true });
  fs.writeFileSync(HANDOFF, body);
}

function setMode(mode) {
  fs.mkdirSync(path.join(CFG, 'mode-router'), { recursive: true });
  fs.writeFileSync(path.join(CFG, 'mode-router', 'state.json'), JSON.stringify({ mode }));
}

// --- auto (default): empty set => full rules + invoke now ---
run('SessionStart');
let out = prompt('explain this');
assert.match(out, /MODE ROUTER/);
assert.match(out, /no mode skill is\s+in this context/, 'empty set => invoke-now wording');
assert.match(out, /Precedence:/, 'empty set => full precedence clause');

// Idempotence: UserPromptSubmit performs no consuming write, so a hook registered
// twice injects the SAME text twice instead of two contradictory blocks. This is
// the direct regression test for the bug that motivated the redesign.
assert.strictEqual(prompt('explain this'), out, 'double execution => identical stdout');

// --- only UserPromptSubmit reaches the routing text ---
// Every other branch exits on its own, so the tail used to be guarded by nothing
// but the order of the branches above it: an event registered in hooks.json and
// not handled here fell straight through and printed routing text on, say, every
// Skill call. Dropping the veto's branch is exactly what made that reachable, so
// the guard is tested rather than assumed.
for (const ev of ['PreToolUse', 'PreCompact', 'Stop']) {
  assert.strictEqual(run(ev, { tool_name: 'Skill', tool_input: { skill: 'ponytail' } }), '',
    ev + ' is not handled here, so it emits nothing at all');
}

// --- PostToolUse on Skill populates the set => the non-empty branch, one mode in ---
loadSkill('caveman');
out = prompt('explain more');
assert.match(out, /MODE ROUTER/, 'classifier still fires every turn');
assert.match(out, /`caveman` is already in this context/, 'loaded mode => no re-invocation');
assert.doesNotMatch(out, /Precedence:/, 'steady state => precedence not repeated');
// The set decides invoke from do-not-re-invoke and nothing else. The mode that is
// missing is asked for the turn it is classified to — it is no longer refused, and
// no switch ceremony is imposed to reach it.
assert.match(out, /if you classify to `ponytail`, invoke it now/, 'the missing mode is invoked on demand');
assert.doesNotMatch(out, /do NOT invoke it/, 'nothing is refused any more');
assert.doesNotMatch(out, /run \/clear/, 'the steady state asks for no context switch');
assert.doesNotMatch(out, /OVERWRITE that file/, "the note's schema left the injected text");
assert.ok(!out.includes(HANDOFF), 'a steady-state turn does not name the note at all');
// One branch, so the suspension reads the same with one mode loaded as with two.
assert.match(out, /the other one is SUSPENDED for this turn/, 'the suspension covers this shape too');
assert.match(out, /not\s+even to prose/, 'suspension denies prose influence too');
assert.match(out, /a coding turn is pure `ponytail`/, 'the concrete leak is named');

// An explicit /ponytail is the user overruling the router. It never reaches the
// tool layer — the harness expands the skill inline and no Skill call fires — so
// it is UserPromptExpansion that records it.
assert.strictEqual(prompt('/ponytail go'), '', '/ponytail => no classifier');
assert.strictEqual(prompt('/caveman:caveman go'), '', 'namespaced mode slash => silent too');
assert.match(prompt('/anti-caveman go'), /MODE ROUTER/, 'lookalike slash => still classified');

// --- both loaded: a mixed context is the normal steady state, not a fallback ---
// The second mode enters by an ordinary path — here a typed slash — and nothing
// intercepts it. Exclusivity is then asserted in words, and these are the words
// that were measured (ADR-0001): they are not rephrased casually.
expand('ponytail');
out = prompt('write code');
assert.match(out, /Both `caveman` and `ponytail` are already in this context/, 'suffix match');
assert.match(out, /invoke\s+neither/, 'both loaded => no invocation is asked for');
assert.match(out, /the other one is SUSPENDED for this turn/, 'name the suppressed mode');
assert.match(out, /not\s+even to prose/, 'suspension denies prose influence too');
assert.match(out, /a coding turn is pure `ponytail`/, 'the concrete leak is named');
// ADR-0001 §Considered options records the wording and rejects it: measured, it
// diluted `caveman` instead of defending it. Layer one asserts it is absent from
// the text; whether the stub itself appears is eval case 5's job, not this file's.
assert.doesNotMatch(out, /no stub/, 'no mirror clause: it was measured and rejected');

// Non-Skill tools never touch the set.
run('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
assert.match(prompt('write code'), /Both `caveman` and `ponytail`/, 'unrelated tools => no change');

// --- SessionStart is a context reset, EXCEPT on resume ---
// Resume rebuilds the context from the transcript, so the modes are still loaded.
run('SessionStart', { source: 'resume' });
assert.match(prompt('after resume'), /Both `caveman` and `ponytail` are already/, 'resume keeps the set');
run('SessionStart', { source: 'compact' });
assert.match(prompt('after compaction'), /no mode skill is\s+in this context/, 'compact clears the set');
loadSkill('caveman');
run('SessionStart', { source: 'startup' });
assert.match(prompt('after startup'), /no mode skill is\s+in this context/, 'startup clears the set');

// --- the handoff survives the reset that discarded the context which wrote it ---
// The router keeps only the READ side of the note: the write side is the /carryover
// command the user types.
fs.mkdirSync(path.dirname(HANDOFF), { recursive: true });
fs.writeFileSync(HANDOFF, '# handoff\nnext: finish the parser\n');
out = prompt('continue');
assert.match(out, /A handoff note left before the last reset is waiting/, 'pending handoff announced');
assert.ok(out.includes(HANDOFF), 'the note is named by path');
assert.match(out, /delete the file once you have taken it over/, 'the model is told to consume it');
fs.unlinkSync(HANDOFF);
assert.doesNotMatch(prompt('continue'), /handoff note left/, 'no note => nothing announced');

// --- two-level expiry: the model deletes an absorbed note, the hook backstops ---
// Level two exists because level one is the observed failure: the model forgets,
// and a day-old note gets served to a fresh context as work in progress.
writeHandoff('# handoff\nnext: finish the parser\n');
const archive = ageHandoff(25 * 60 * 60 * 1000);
assert.doesNotMatch(prompt('continue'), /handoff note left/,
  'a note past 24h is not served as current');
// A resume walks back into the context that wrote the note: nothing is retired.
run('SessionStart', { source: 'resume' });
assert.ok(fs.existsSync(HANDOFF), 'resume retires nothing — it is not a reset');
run('SessionStart');
assert.ok(!fs.existsSync(HANDOFF), 'a real reset moves the stale note out of the way');
assert.strictEqual(fs.readFileSync(archive, 'utf8'), '# handoff\nnext: finish the parser\n',
  'the stale note is archived verbatim, never deleted');
// Just inside the window: still current, so still served and still left alone.
writeHandoff('still pending');
ageHandoff(23 * 60 * 60 * 1000);
run('SessionStart');
assert.ok(fs.existsSync(HANDOFF), 'a note inside the window survives the reset');
assert.match(prompt('continue'), /A handoff note left before the last reset is waiting/,
  'a note inside the window is served as current');
fs.unlinkSync(HANDOFF);
fs.unlinkSync(archive);

// --- mirror image: a ponytail-only set must read the same way round ---
run('SessionStart');
loadSkill('ponytail');
out = prompt('explain this');
assert.match(out, /`ponytail` is already in this context/, 'ponytail-only => named as loaded');
assert.match(out, /if you classify to `caveman`, invoke it now/, 'ponytail-only => caveman is the missing one');
// The other ordinary path into a mixed context: a Skill call for the second mode,
// which the router records instead of intercepting.
loadSkill('caveman');
assert.match(prompt('explain this'), /Both `caveman` and `ponytail` are already/,
  'a Skill call for the second mode is recorded, not refused');

// --- expansion details: namespaced names register ---
run('SessionStart');
expand('caveman:caveman');
out = prompt('explain this');
assert.match(out, /`caveman` is already in this context/, 'namespaced command_name registers');
assert.doesNotMatch(out, /Recorded for the note/, 'the list never rides a steady-state turn');

// --- subagent tool events (`agent_id` set) belong to a DIFFERENT context ---
run('PostToolUse', { tool_name: 'Skill', tool_input: { skill: 'ponytail' }, agent_id: 'a-1' });
assert.strictEqual(prompt('explain this'), out, 'a subagent skill load does not pollute the set');
run('PostToolUse', { tool_name: 'Skill', tool_input: { skill: 'grilling' }, agent_id: 'a-1' });
assert.strictEqual(prompt('explain this'), out, "a subagent's non-mode skill is not recorded either");

// --- what entered the context crosses the reset inside the handoff note ---
const modesFile = path.join(STATE, 'mode-router', `session-${SID}.json`);
const skillsF = path.join(STATE, 'mode-router', `session-${SID}.skills.json`);
run('SessionStart');
loadSkill('caveman');
expand('grilling');
loadSkill('implement:implement');
// Bare and namespaced are the same skill: dedup is on the last segment, or the
// clause would tell the user to re-type what the model can invoke itself.
loadSkill('grilling:grilling');
expand('implement');
// Modes live in their own file, which a skill write must never touch: the set is
// what every turn's text is computed from.
assert.deepStrictEqual(JSON.parse(fs.readFileSync(modesFile, 'utf8')), { modes: ['caveman'] },
  'the mode set survives skill writes and holds no skills');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(skillsF, 'utf8')), {
  skills: [
    { name: 'grilling', source: 'typed' },
    { name: 'implement:implement', source: 'model' },
  ],
}, 'one entry per skill, first arrival keeps the tag, modes excluded');

// --- the /carryover turn: the list, and nothing about routing ---
// The list is emitted once, on the turn the user asks for a note — not on every
// prompt. That is the per-turn saving 0.8.0 adds on top of dropping the veto.
assert.doesNotMatch(prompt('carry on'), /Recorded for the note/, 'a steady turn says nothing about the list');
out = prompt(CARRYOVER);
assert.doesNotMatch(out, /MODE ROUTER/, 'the note has no prose to style, so no classification');
assert.doesNotMatch(out, /SUSPENDED/, 'and no suspension clause either');
assert.match(out, /TYPED here: \/grilling/, 'a typed name is listed as the slash to re-type');
assert.match(out, /INVOKED here: `implement:implement`/, 'an invoked name is listed for re-invocation');
// DATA, not instructions: what to do with each group is static text, and lives in
// the command file so that one instruction is maintained in one place.
assert.doesNotMatch(out, /one-shot actions are in there too/, 'the clause does not restate the command file');
assert.doesNotMatch(out, /one per message/, 'nor the re-typing rule');
// The path is the half that must not drift: the command file can only carry a
// relative one, and the read side resolves it against cwd.
assert.ok(out.includes(HANDOFF), 'the /carryover turn names the resolved path the hook reads back');
assert.match(out, /Write the note to/, 'and says what to do with it');
assert.match(prompt(CARRYOVER + '-notes go'), /MODE ROUTER/, 'a lookalike command is still classified');
// The command that WRITES the note stays out of the list, or the note cites itself.
// Only the namespaced form is expanded, because that is the only form the harness
// exposes — measured, and the reason the bare one is not accepted below.
expand('mode-router:carryover');
assert.strictEqual(prompt(CARRYOVER), out, 'this command is never recorded as a typed skill');

// --- whose turn it is. Three names this hook must NOT claim, each for its own
// measured reason (ADR-0004):
//
//   /carryover          the bare form. Not exposed by the harness at all: typed,
//                       it dies as `Unknown command` before UserPromptSubmit
//                       fires. Through 0.8.0 the equivalent bare name WAS claimed,
//                       which is how a turn that expanded another plugin's body
//                       got this one's note path injected into it.
//   /handoff…           another plugin's command, named what this one used to be.
//   /productivity:…     the leaf() rule the modes use would capture any
//                       `X:carryover` and suppress routing on a turn this plugin
//                       has no part in.
// ---
for (const foreign of ['/carryover', '/handoff', '/handoff:handoff', '/productivity:carryover']) {
  const o = prompt(foreign);
  assert.match(o, /MODE ROUTER/, foreign + ' is not this command => still classified');
  assert.doesNotMatch(o, /Recorded for the note/, 'and gets no list aimed at a note it does not write');
}
// Foreign commands are ordinary skills, so they are recorded like any other — the
// BARE form included, which is the consequence the rename exists for: `handoff` is
// somebody else's name now, not one this plugin swallows as its own.
expand('handoff');
assert.match(prompt(CARRYOVER), /TYPED here: [^.]*\/handoff\b/,
  'a bare /handoff is recorded, not filtered out as this plugin\'s command');
// And the namespaced form is the same skill, so it dedups onto the entry already
// there rather than filing it twice under contradictory names.
expand('handoff:handoff');
const bothForms = prompt(CARRYOVER);
assert.match(bothForms, /TYPED here: [^.]*\/handoff\b/, 'still recorded');
assert.doesNotMatch(bothForms, /\/handoff:handoff/,
  'the namespaced form dedups onto the bare one: one skill, one entry, first arrival keeps the tag');

// The list feeds a note with a ~30-line budget, so it must not grow unbounded.
for (let i = 0; i < 20; i++) loadSkill('filler-' + i);
const capped = JSON.parse(fs.readFileSync(skillsF, 'utf8')).skills;
assert.strictEqual(capped.length, 12, 'the recorded list is capped');
assert.strictEqual(capped[capped.length - 1].name, 'filler-19', 'the cap drops the oldest entries');

// A context reset drops both files, not just the mode set.
run('SessionStart');
assert.ok(!fs.existsSync(skillsF), 'a reset clears the recorded skills too');
assert.ok(!fs.existsSync(modesFile), 'a reset clears the mode set');
// Nothing recorded => the list is empty, but the path is not optional, and the
// turn must NOT fall through to the classifier.
out = prompt(CARRYOVER);
assert.ok(out.includes(HANDOFF), 'an empty list still leaves the resolved path');
assert.doesNotMatch(out, /Recorded for the note/, 'and nothing else');
assert.doesNotMatch(out, /MODE ROUTER/, 'an empty list does not fall through to the classifier');

// State written before this feature has no skills file at all, and still reads.
loadSkill('caveman');
out = prompt('carry on');
assert.match(out, /`caveman` is already in this context/, 'legacy state still yields the mode');
out = prompt(CARRYOVER);
assert.ok(out.includes(HANDOFF), 'no skills file => still the path');
assert.doesNotMatch(out, /Recorded for the note/, 'no skills file => no clause');

// The fresh context is told how to get each group back.
fs.mkdirSync(path.dirname(HANDOFF), { recursive: true });
fs.writeFileSync(HANDOFF, '# handoff\nskills: /grilling\n');
run('SessionStart');
out = prompt('continue');
assert.match(out, /re-invoke the ones you can reach/, 'reachable skills come back by Skill call');
assert.match(out, /ask the user to\s+re-type the rest/, 'the rest have to be asked for');
fs.unlinkSync(HANDOFF);

// --- forced caveman: invoke while missing, silent once loaded ---
setMode('caveman');
run('SessionStart');
out = prompt('anything');
assert.match(out, /Forced caveman mode/, 'not in set => invoke forced skill');
assert.match(out, /Precedence:/, 'forced caveman => precedence clause present');
assert.strictEqual(prompt('anything'), out, 'forced mode is idempotent too');
// A forced mode is a standing choice about style; the /carryover turn has no prose
// to style, and needs the one half the command file cannot carry.
expand('grilling');
out = prompt(CARRYOVER);
assert.match(out, /Recorded for the note/, 'forced mode => /carryover still gets the list');
assert.doesNotMatch(out, /Forced caveman/, 'and nothing about routing');
loadSkill('caveman');
assert.strictEqual(prompt('anything else'), '', 'in set => nothing (skill persists)');

// --- forced ponytail: same shape, and a namespaced name still registers ---
setMode('ponytail');
run('SessionStart');
assert.match(prompt('anything'), /Forced ponytail mode/, 'not in set => invoke forced ponytail');
loadSkill('plugin:ponytail');
assert.strictEqual(prompt('anything else'), '', 'in set => nothing');

// --- off: never emits, whatever the turn ---
setMode('off');
run('SessionStart');
assert.strictEqual(prompt('anything'), '', 'off => empty even with an empty set');
expand('grilling');
// SKILL.md: `off` means "inject nothing". Not the list, and not the path either.
assert.strictEqual(prompt(CARRYOVER), '', 'off => not even the skill list: inject nothing means nothing');
loadSkill('caveman');
assert.strictEqual(prompt('anything'), '', 'off => the router gets out of the way entirely');

// --- TTL sweep on SessionStart: stale state goes, fresh state stays ---
setMode('auto');
const stateHome = path.join(STATE, 'mode-router');
const stale = path.join(stateHome, 'session-old.json');
const fresh = path.join(stateHome, 'session-new.json');
fs.mkdirSync(stateHome, { recursive: true });
fs.writeFileSync(stale, JSON.stringify({ modes: ['caveman'] }));
fs.writeFileSync(fresh, JSON.stringify({ modes: ['caveman'] }));
const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
fs.utimesSync(stale, old / 1000, old / 1000);
// The TTL sweep reads stateDir() and configDir() only, so nothing in the user's
// project is in its reach — neither a pending note nor an archive, however old.
// Retiring a note is the 24h backstop's job, and it archives instead of deleting.
writeHandoff('still pending');
const oldArchive = path.join(CWD, '.mode-router', 'handoff-2020-01-01T00-00-00-000Z.md');
fs.writeFileSync(oldArchive, 'archived');
fs.utimesSync(oldArchive, old / 1000, old / 1000);
// Leftovers from the retired reload-flag design landed in the CONFIG dir.
const legacy = path.join(CFG, 'mode-router', 'reload-sess-9');
fs.writeFileSync(legacy, '');
run('SessionStart');
assert.ok(!fs.existsSync(stale), 'state older than the TTL is swept');
assert.ok(fs.existsSync(fresh), 'recent state survives the sweep');
assert.ok(fs.existsSync(HANDOFF), "a current handoff note is out of the sweep's reach");
assert.ok(fs.existsSync(oldArchive), 'archives are never swept, however old');
assert.ok(!fs.existsSync(legacy), 'legacy reload flags are removed from the config dir');
assert.ok(fs.existsSync(path.join(CFG, 'mode-router', 'state.json')), 'the control file survives');

// The CURRENT session's set is never garbage: a resume can arrive past the TTL,
// and resume must keep the set — the sweep must not undo the resume carve-out.
const mine = path.join(stateHome, `session-${SID}.json`);
fs.writeFileSync(mine, JSON.stringify({ modes: ['ponytail'] }));
fs.utimesSync(mine, old / 1000, old / 1000);
run('SessionStart', { source: 'resume' });
assert.match(prompt('after a late resume'), /`ponytail` is already in this context/,
  'a resume past the TTL still keeps the set');

// --- the note's shape, at its new address ---
// The schema left the hook for commands/carryover.md: static text belongs in a file.
// The four sections and the line budget are what stop the dumping BY CONSTRUCTION
// ("keep it short" does not), so the contract is still covered here.
const cmd = fs.readFileSync(CARRYOVER_MD, 'utf8');
assert.match(cmd, /^disable-model-invocation: true$/m,
  'a note exists because the USER asked for one — the router no longer collects it');
const sections = ['## Prompt to send', '## Skills', '## Decided', '## Next step']
  .map((h) => cmd.indexOf(h));
assert.ok(sections.every((i) => i > 0), 'all four sections are named');
assert.deepStrictEqual(sections, [...sections].sort((a, b) => a - b),
  'the actionable section comes first and the order is fixed');
assert.match(cmd, /OVERWRITE/, 'one note at a time, overwritten');
assert.match(cmd, /About 30 lines/, 'the note has a hard line budget');
// The budget is enforced by a positive test the model can apply line by line —
// steering by prohibition names the unwanted output and makes it more available,
// not less, so the ban became "what every line has to earn".
assert.match(cmd, /Every line earns its place/, 'the budget is a test, not a list of bans');
assert.match(cmd, /fifth section/, 'and the spare section stays out');
// The two halves have to meet: the command consumes what the hook emits, and takes
// the PATH from the hook rather than re-deriving a relative one of its own — the
// failure that would write a note where nothing reads it.
assert.match(cmd, /Recorded for the note/, "the command reads the hook's half by name");
assert.match(cmd, /Write the note to/, 'the command quotes the line the hook emits');
assert.match(cmd, /Do not re-derive it from the project\s+root/,
  'and is told not to re-derive the path itself');

fs.rmSync(CFG, { recursive: true, force: true });
fs.rmSync(STATE, { recursive: true, force: true });
fs.rmSync(CWD, { recursive: true, force: true });
console.log('ok');
