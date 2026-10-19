#!/usr/bin/env node
// Replays every Bash command in this machine's session transcripts through the
// zsh-wordsplit-guard hooks and prints what each would deny or rewrite. The
// measurement ADR-0005 drew its line with: a new deny rule reports its hits
// here, and a hit that is correct zsh is a false positive to fix before merging.
//
// Local only, never in CI: the corpus is personal history. Usage:
//   node scripts/replay-wordsplit-guard.js [--hook guard.js|expansion.js|<path>]
//     [--filter <regex>] [<transcripts dir>]
// The default dir is ~/.claude/projects; --filter narrows the commands replayed
// (e.g. '\bfor\s' for the loop rules) and keeps a run to seconds.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const HOOKS = path.join(__dirname, '..', 'plugins', 'zsh-wordsplit-guard', 'hooks');

function parseArgs(argv) {
  const opts = { hooks: [], filter: null, dir: path.join(os.homedir(), '.claude', 'projects') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hook') opts.hooks.push(path.resolve(HOOKS, argv[++i]));
    else if (argv[i] === '--filter') opts.filter = new RegExp(argv[++i]);
    else opts.dir = argv[i];
  }
  if (!opts.hooks.length) opts.hooks = ['guard.js', 'expansion.js'].map((h) => path.join(HOOKS, h));
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
        if (command && (!filter || filter.test(command))) seen.add(command);
      }
    }
  }
  return [...seen];
}

// The hook's verdict on one command: 'deny', 'rewrite', or null.
function verdict(hook, command) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hook], { env: Object.assign({}, process.env, { ALLOW_ZSH_NOSPLIT: '' }) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => {
      const hso = out.trim() ? JSON.parse(out).hookSpecificOutput : null;
      resolve(!hso ? null : hso.permissionDecision === 'deny' ? 'deny' : 'rewrite');
    });
    child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command: command, description: 'replay' } }));
  });
}

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
      if (v) hits.push(Object.assign({ verdict: v }, job));
    }
  }));
  for (const h of hits) {
    console.log('--- ' + h.verdict + ' (' + path.basename(h.hook) + ')\n' + h.command);
  }
  console.log('\n' + all.length + ' unique commands replayed; ' + hits.length + ' hits.');
}

main();
