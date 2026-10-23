#!/usr/bin/env node
// Replays every Bash command in this machine's session transcripts through the
// zsh-wordsplit-guard hooks and prints what each would deny or rewrite. The
// measurement ADR-0005 drew its line with: a new deny rule reports its hits
// here, and a hit that is correct zsh is a false positive to fix before merging.
//
// Local only, never in CI: the corpus is personal history. Usage:
//   node scripts/replay-wordsplit-guard.js [--hook guard.js|expansion.js|command.js|<path>]
//     [--filter <regex>] [--json] [<transcripts dir>]
// --json emits hits and grouped counts using SHA-256 command/reason IDs, never
// transcript or reason text. Backticked spans are blanked before hashing reasons
// so renamed variables group together. Text mode prints raw commands: keep it private.
// The default dir is ~/.claude/projects; --filter narrows the commands replayed
// (e.g. '\bfor\s' for the loop rules) and keeps a run to seconds.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { createHash } = require('crypto');

const HOOKS = path.join(__dirname, '..', 'plugins', 'zsh-wordsplit-guard', 'hooks');

function parseArgs(argv) {
  const opts = { hooks: [], filter: null, json: false, dir: path.join(os.homedir(), '.claude', 'projects') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hook') opts.hooks.push(path.resolve(HOOKS, argv[++i]));
    else if (argv[i] === '--filter') opts.filter = new RegExp(argv[++i]);
    else if (argv[i] === '--json') opts.json = true;
    else opts.dir = argv[i];
  }
  if (!opts.hooks.length) opts.hooks = ['guard.js', 'expansion.js', 'command.js'].map((h) => path.join(HOOKS, h));
  return opts;
}

function* transcripts(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* transcripts(p);
    else if (p.endsWith('.jsonl')) yield p;
  }
}

// Line by line: a transcript can outgrow the longest string node will build.
async function commands(dir, filter) {
  const seen = new Set();
  for (const file of transcripts(dir)) {
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('"Bash"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (e) { continue; }
      const content = entry.message && Array.isArray(entry.message.content) ? entry.message.content : [];
      for (const c of content) {
        const command = c.type === 'tool_use' && c.name === 'Bash' && c.input && c.input.command;
        if (typeof command === 'string' && command && (!filter || filter.test(command))) seen.add(command);
      }
    }
  }
  return [...seen];
}

// The verdict and its reason, or null for a command the hook leaves alone.
function verdict(hook, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], { env: Object.assign({}, process.env, { ALLOW_ZSH_NOSPLIT: '' }) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    // Discard diagnostics: a hook can print the private command or its values.
    child.stderr.resume();
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(path.basename(hook) + ' exited with ' + code));
      let hso;
      try { hso = out.trim() ? JSON.parse(out).hookSpecificOutput : null; }
      catch (e) { return reject(new Error('Invalid output from ' + path.basename(hook))); }
      resolve(!hso ? null : {
        verdict: hso.permissionDecision === 'deny' ? 'deny' : 'rewrite',
        reason: String(hso.permissionDecisionReason || hso.additionalContext || ''),
      });
    });
    child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command: command, description: 'replay' } }));
  });
}

const hash = (text) => createHash('sha256').update(text).digest('hex');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const all = await commands(opts.dir, opts.filter);
  const jobs = opts.hooks.flatMap((hook) => all.map((command) => ({ hook, command })));
  const hits = [];
  let next = 0;
  await Promise.all(Array.from({ length: os.cpus().length }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const v = await verdict(job.hook, job.command);
      if (v) hits.push(Object.assign({}, job, v));
    }
  }));
  if (opts.json) {
    const report = hits.map((h) => ({
      commandId: hash(h.command),
      hook: path.relative(HOOKS, h.hook),
      verdict: h.verdict,
      reasonId: hash(h.reason.replace(/`[^`]*`/g, '`…`')),
    })).sort((a, b) => a.hook.localeCompare(b.hook) || a.commandId.localeCompare(b.commandId));
    const groups = new Map();
    for (const hit of report) {
      const key = JSON.stringify([hit.hook, hit.verdict, hit.reasonId]);
      if (!groups.has(key)) groups.set(key, { hook: hit.hook, verdict: hit.verdict, reasonId: hit.reasonId, hits: 0 });
      groups.get(key).hits++;
    }
    console.log(JSON.stringify({ commands: all.length, hits: report, summary: [...groups.values()] }));
  } else {
    for (const h of hits) {
      console.log('--- ' + h.verdict + ' (' + path.basename(h.hook) + ')\n' + h.command);
    }
    console.log('\n' + all.length + ' unique commands replayed; ' + hits.length + ' hits.');
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
