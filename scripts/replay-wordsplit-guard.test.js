#!/usr/bin/env node
// Self-check for replay-wordsplit-guard.js. Run: node scripts/replay-wordsplit-guard.test.js
//
// A fake transcript tree stands in for ~/.claude/projects: a trap, a correct
// command, the trap again in another session (counted once), a non-Bash tool
// and a line that is not JSON. A replay that silently reads nothing would report
// "0 hits" forever, so the trap must come out as a hit.
const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TRAP = 'v="a b"; for x in $v; do echo $x; done';
const line = (name, command) => JSON.stringify({
  message: { role: 'assistant', content: [{ type: 'tool_use', name: name, input: { command: command } }] },
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-wordsplit-'));
try {
  fs.mkdirSync(path.join(dir, 'project', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project', 'a.jsonl'),
    [line('Bash', TRAP), line('Bash', 'for f in *.md; do echo "$f"; done'), '{"Bash" not json'].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'project', 'sub', 'b.jsonl'),
    [line('Bash', TRAP), line('Agent', TRAP)].join('\n') + '\n');

  const run = (args) => spawnSync(process.execPath, [path.join(__dirname, 'replay-wordsplit-guard.js')].concat(args, dir),
    { encoding: 'utf8' });

  let r = run(['--hook', 'guard.js']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('--- deny (guard.js)\n' + TRAP), 'the trap is reported as a deny:\n' + r.stdout);
  assert.ok(r.stdout.includes('2 unique commands replayed; 1 hits.'), 'deduplicated, Bash only:\n' + r.stdout);

  r = run(['--hook', 'guard.js', '--filter', '\\*\\.md']);
  assert.ok(r.stdout.includes('1 unique commands replayed; 0 hits.'), '--filter narrows the replay:\n' + r.stdout);

  r = run([]);
  assert.ok(r.stdout.includes('2 unique commands replayed; 1 hits.'), 'both hooks by default:\n' + r.stdout);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('replay-wordsplit-guard: all checks passed');
