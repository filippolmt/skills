#!/usr/bin/env node
// Self-check for route.js. Run: node route.test.js
// Drives the loaded-mode set, the one-mode-per-context veto and the handoff
// hand-over end to end via real subprocess runs.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'route.js');
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

// Returns the deny reason, or null when the call is allowed through.
function veto(skill, payload) {
  const out = run('PreToolUse', { tool_name: 'Skill', tool_input: { skill }, ...payload });
  if (!out) return null;
  const d = JSON.parse(out).hookSpecificOutput;
  assert.strictEqual(d.permissionDecision, 'deny');
  return d.permissionDecisionReason;
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

// An empty context takes any mode: nothing to conflict with.
assert.strictEqual(veto('caveman'), null, 'empty set => first mode allowed');

// --- PostToolUse on Skill populates the set ---
loadSkill('caveman');
out = prompt('explain more');
assert.match(out, /MODE ROUTER/, 'classifier still fires every turn');
assert.match(out, /`caveman` is already in this context/, 'loaded mode => no re-invocation');
assert.doesNotMatch(out, /Precedence:/, 'steady state => precedence not repeated');
// The switch procedure is taught here, in the channel the model trusts.
assert.match(out, /do NOT invoke it/, 'switching => the other mode is not invoked');
assert.match(out, /run \/clear/, 'switching => the user is asked to clear');
assert.ok(out.includes(HANDOFF), 'the handoff path is keyed by cwd and named verbatim');

// --- the veto: one mode per context, enforced rather than requested ---
assert.strictEqual(veto('caveman'), null, 'already loaded => re-invoke allowed');
assert.strictEqual(veto('grilling:grilling'), null, 'non-mode skills are untouched');
out = run('PreToolUse', { tool_name: 'Bash', tool_input: { skill: 'ponytail' } });
assert.strictEqual(out, '', 'only the Skill tool is vetoed, whatever the payload');
let reason = veto('ponytail');
assert.match(reason, /`caveman` is already loaded in this context/, 'second mode => denied');
assert.match(reason, /at most one mode skill/, 'the reason states the constraint');
assert.doesNotMatch(reason, /\/clear/, 'the deny reason gives no orders — tool output is untrusted');
assert.ok(veto('plugin:ponytail'), 'a namespaced second mode is denied too');

// An explicit /ponytail is the user overruling the router. It never reaches the
// tool layer — the harness expands the skill inline and no Skill call fires — so
// it is UserPromptExpansion that records it, and it is never denied.
assert.strictEqual(prompt('/ponytail go'), '', '/ponytail => no classifier');
assert.strictEqual(prompt('/caveman:caveman go'), '', 'namespaced mode slash => silent too');
assert.match(prompt('/anti-caveman go'), /MODE ROUTER/, 'lookalike slash => still classified');
expand('ponytail');
assert.strictEqual(veto('ponytail'), null, 'a recorded user-typed mode reads as a re-invoke');

// --- both loaded (the user typed the second mode in): exclusivity can only be
// asserted in words ---
out = prompt('write code');
assert.match(out, /Both `caveman` and `ponytail` are already in this context/, 'suffix match');
assert.match(out, /the other one is SUSPENDED for this turn/, 'name the suppressed mode');
assert.match(out, /not\s+even to prose/, 'suspension denies prose influence too');
assert.match(out, /a coding turn is pure `ponytail`/, 'the concrete leak is named');

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
fs.mkdirSync(path.dirname(HANDOFF), { recursive: true });
fs.writeFileSync(HANDOFF, '# handoff\nnext: finish the parser\n');
out = prompt('continue');
assert.match(out, /A handoff note left before the last reset is waiting/, 'pending handoff announced');
assert.ok(out.includes(HANDOFF), 'the note is named by path');
assert.match(out, /delete the file once you have taken it over/, 'the model is told to consume it');
fs.unlinkSync(HANDOFF);
assert.doesNotMatch(prompt('continue'), /handoff note left/, 'no note => nothing announced');

// --- mirror image: a ponytail-only set must read the same way round ---
run('SessionStart');
loadSkill('ponytail');
out = prompt('explain this');
assert.match(out, /`ponytail` is already in this context/, 'ponytail-only => named as loaded');
assert.ok(veto('caveman'), 'ponytail-only => caveman denied');

// --- expansion details: namespaced names register ---
run('SessionStart');
expand('caveman:caveman');
out = prompt('explain this');
assert.match(out, /`caveman` is already in this context/, 'namespaced command_name registers');
assert.doesNotMatch(out, /Recorded for the note/, 'nothing else in the context => no skill clause');

// --- subagent tool events (`agent_id` set) belong to a DIFFERENT context ---
run('PostToolUse', { tool_name: 'Skill', tool_input: { skill: 'ponytail' }, agent_id: 'a-1' });
assert.strictEqual(prompt('explain this'), out, 'a subagent skill load does not pollute the set');
run('PostToolUse', { tool_name: 'Skill', tool_input: { skill: 'grilling' }, agent_id: 'a-1' });
assert.strictEqual(prompt('explain this'), out, "a subagent's non-mode skill is not recorded either");
out = run('PreToolUse', { tool_name: 'Skill', tool_input: { skill: 'ponytail' }, agent_id: 'a-1' });
assert.strictEqual(out, '', 'a subagent first mode is not vetoed by this context');

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
// Modes live in their own file, which a skill write must never touch — losing a
// mode would disarm the veto.
assert.deepStrictEqual(JSON.parse(fs.readFileSync(modesFile, 'utf8')), { modes: ['caveman'] },
  'the mode set survives skill writes and holds no skills');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(skillsF, 'utf8')), {
  skills: [
    { name: 'grilling', source: 'typed' },
    { name: 'implement:implement', source: 'model' },
  ],
}, 'one entry per skill, first arrival keeps the tag, modes excluded');

out = prompt('carry on');
assert.match(out, /Recorded for the note/, 'the note is asked for what entered the context');
assert.match(out, /TYPED here: \/grilling/, 'a typed name is listed as the slash to re-type');
assert.match(out, /INVOKED here: `implement:implement`/, 'an invoked name is listed for re-invocation');
assert.match(out, /one-shot actions are in there too/, 'the typed list is not only skills, and says so');
assert.match(out, /one per message/, 'only the leading slash of a message expands');

// The list is injected every steady-state turn, so it must not grow unbounded.
for (let i = 0; i < 20; i++) loadSkill('filler-' + i);
const capped = JSON.parse(fs.readFileSync(skillsF, 'utf8')).skills;
assert.strictEqual(capped.length, 12, 'the recorded list is capped');
assert.strictEqual(capped[capped.length - 1].name, 'filler-19', 'the cap drops the oldest entries');

// A context reset drops both files, not just the mode set.
run('SessionStart');
assert.ok(!fs.existsSync(skillsF), 'a reset clears the recorded skills too');
assert.ok(!fs.existsSync(modesFile), 'a reset clears the mode set');

// State written before this feature has no skills file at all, and still reads.
loadSkill('caveman');
out = prompt('carry on');
assert.match(out, /`caveman` is already in this context/, 'legacy state still yields the mode');
assert.doesNotMatch(out, /Recorded for the note/, 'no skills file => no clause');

// The fresh context is told how to get each group back.
fs.mkdirSync(path.dirname(HANDOFF), { recursive: true });
fs.writeFileSync(HANDOFF, '# handoff\nskills: /grilling\n');
run('SessionStart');
out = prompt('continue');
assert.match(out, /re-invoke the ones you can reach/, 'reachable skills come back by Skill call');
assert.match(out, /ask the user to\s+re-type the rest/, 'the rest have to be asked for');
fs.unlinkSync(HANDOFF);

// --- forced caveman: invoke while missing, silent once loaded, never vetoed ---
setMode('caveman');
run('SessionStart');
out = prompt('anything');
assert.match(out, /Forced caveman mode/, 'not in set => invoke forced skill');
assert.match(out, /Precedence:/, 'forced caveman => precedence clause present');
assert.strictEqual(prompt('anything'), out, 'forced mode is idempotent too');
loadSkill('ponytail');
assert.strictEqual(veto('caveman'), null, 'a standing forced choice outranks the veto');
loadSkill('caveman');
assert.strictEqual(prompt('anything else'), '', 'in set => nothing (skill persists)');

// --- forced ponytail: same shape, and a namespaced name still registers ---
setMode('ponytail');
run('SessionStart');
assert.match(prompt('anything'), /Forced ponytail mode/, 'not in set => invoke forced ponytail');
loadSkill('plugin:ponytail');
assert.strictEqual(prompt('anything else'), '', 'in set => nothing');

// --- off: never emits, never vetoes ---
setMode('off');
run('SessionStart');
assert.strictEqual(prompt('anything'), '', 'off => empty even with an empty set');
loadSkill('caveman');
assert.strictEqual(veto('ponytail'), null, 'off => the router gets out of the way entirely');

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
// A handoff note is unfinished work in the user's project: age must not delete it.
fs.mkdirSync(path.dirname(HANDOFF), { recursive: true });
fs.writeFileSync(HANDOFF, 'still pending');
fs.utimesSync(HANDOFF, old / 1000, old / 1000);
// Leftovers from the retired reload-flag design landed in the CONFIG dir.
const legacy = path.join(CFG, 'mode-router', 'reload-sess-9');
fs.writeFileSync(legacy, '');
run('SessionStart');
assert.ok(!fs.existsSync(stale), 'state older than the TTL is swept');
assert.ok(fs.existsSync(fresh), 'recent state survives the sweep');
assert.ok(fs.existsSync(HANDOFF), 'an old handoff note is NOT swept — it is unfinished work');
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

fs.rmSync(CFG, { recursive: true, force: true });
fs.rmSync(STATE, { recursive: true, force: true });
fs.rmSync(CWD, { recursive: true, force: true });
console.log('ok');
