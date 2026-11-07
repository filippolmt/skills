#!/usr/bin/env node
// Self-check for replay-wordsplit-guard.js. Run: node scripts/replay-wordsplit-guard.test.js
//
// A fake transcript tree stands in for ~/.claude/projects: a trap, a correct
// command, the trap again in another session (counted once), a non-Bash tool
// and a line that is not JSON. A replay that silently reads nothing would report
// "0 hits" forever, so the trap must come out as a hit.
const assert = require('assert');
const { spawnSync, execFileSync } = require('child_process');
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
    [line('Bash', TRAP), line('Agent', TRAP), line('Bash', 42)].join('\n') + '\n');

  const run = (args) => spawnSync(process.execPath, [path.join(__dirname, 'replay-wordsplit-guard.js')].concat(args, dir),
    { encoding: 'utf8' });

  let r = run(['--hook', 'guard.js']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('--- deny (guard.js)\n' + TRAP), 'the trap is reported as a deny:\n' + r.stdout);
  assert.ok(r.stdout.includes('2 unique commands replayed; 1 hits.'), 'deduplicated, Bash only:\n' + r.stdout);

  r = run(['--hook', 'guard.js', '--filter', '\\*\\.md']);
  assert.ok(r.stdout.includes('1 unique commands replayed; 0 hits.'), '--filter narrows the replay:\n' + r.stdout);

  r = run([]);
  assert.ok(r.stdout.includes('2 unique commands replayed; 1 hits.'), 'all hooks by default:\n' + r.stdout);

  const renamedTrap = 'secret_list="private-value another-value"; for x in $secret_list; do echo $x; done';
  fs.writeFileSync(path.join(dir, 'project', 'private.jsonl'), line('Bash', renamedTrap) + '\n');
  r = run(['--hook', 'guard.js', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.commands, 3);
  assert.strictEqual(report.hits.length, 2);
  assert.strictEqual(report.summary.length, 1, 'renamed variables share a normalized reason');
  assert.deepStrictEqual(report.summary[0], {
    hook: 'guard.js', verdict: 'deny', reasonId: report.hits[0].reasonId, hits: 2,
  });
  assert.strictEqual(new Set(report.hits.map((hit) => hit.commandId)).size, 2);
  for (const hit of report.hits) {
    assert.match(hit.commandId, /^[a-f0-9]{64}$/);
    assert.match(hit.reasonId, /^[a-f0-9]{64}$/);
  }
  assert.ok(!r.stdout.includes('private-value') && !r.stdout.includes('secret_list'), 'no transcript text in JSON');
  assert.ok(!r.stdout.includes(TRAP), 'no raw command in JSON');

  r = run(['--hook', 'guard.js', '--filter', '\\*\\.md', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), { commands: 1, hits: [], summary: [] });

  fs.writeFileSync(path.join(dir, 'project', 'rewrite.jsonl'), line('Bash', 'echo =====') + '\n');
  r = run(['--hook', 'expansion.js', '--filter', '=====', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).hits[0].verdict, 'rewrite');

  const customHooks = ['hook-a', 'hook-b'].map((name) => {
    const file = path.join(dir, name, 'guard.js');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, 'process.stdout.write(' + JSON.stringify(JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'private-reason outside backticks' },
    })) + ');');
    return file;
  });
  r = run(['--hook', customHooks[0], '--hook', customHooks[1], '--filter', '=====', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const customReport = JSON.parse(r.stdout);
  assert.strictEqual(customReport.hits.length, 2);
  assert.strictEqual(customReport.summary.length, 2, 'different hooks with the same filename stay distinct');
  assert.ok(!r.stdout.includes('private-reason'), 'even unquoted reason text stays private');

  const brokenHook = path.join(dir, 'broken.js');
  fs.writeFileSync(brokenHook, 'process.exit(1);');
  r = run(['--hook', brokenHook, '--json']);
  assert.notStrictEqual(r.status, 0, 'failed hooks must not look like allowed commands');
  assert.ok(!r.stderr.includes('private-value'), 'failure output stays private');
  fs.writeFileSync(brokenHook, 'process.stdout.write("private-value not JSON");');
  r = run(['--hook', brokenHook, '--json']);
  assert.notStrictEqual(r.status, 0, 'invalid hook output fails the replay');
  assert.ok(!r.stderr.includes('private-value'), 'invalid output stays private');

  r = run(['--hook', 'missing.js']);
  assert.notStrictEqual(r.status, 0, 'a missing hook fails the replay');
  assert.ok(r.stderr.includes('no such hook: missing.js'), 'and names it:\n' + r.stderr);

  // --base: a tree whose expansion.js allows everything stands in for an older ref.
  const repo = path.join(__dirname, '..');
  const index = { GIT_INDEX_FILE: path.join(dir, 'index') };
  const git = (args, input) => execFileSync('git', ['-C', repo].concat(args),
    { input: input, encoding: 'utf8', env: Object.assign({}, process.env, index) }).trim();
  git(['read-tree', 'HEAD']);
  const blob = git(['hash-object', '-w', '--stdin'], 'process.exit(0);\n');
  git(['update-index', '--cacheinfo', '100644,' + blob + ',plugins/zsh-wordsplit-guard/hooks/expansion.js']);
  const allowAll = git(['write-tree']);
  r = run(['--hook', 'expansion.js', '--filter', '=====', '--base', allowAll, '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const changed = JSON.parse(r.stdout);
  assert.strictEqual(changed.hits.length, 1, 'the changed verdict is reported');
  assert.strictEqual(changed.hits[0].verdict, 'rewrite');
  assert.strictEqual(changed.hits[0].base, 'allow');
  assert.strictEqual(changed.summary[0].base, 'allow');
  r = run(['--hook', 'expansion.js', '--filter', '=====', '--base', allowAll]);
  assert.ok(r.stdout.includes('--- rewrite (expansion.js, was allow)\necho ====='), 'text mode names the old verdict:\n' + r.stdout);
  r = run(['--hook', 'expansion.js', '--filter', '=====', '--base', 'HEAD', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout).hits, [], 'an unchanged verdict is left out');
  r = run(['--hook', customHooks[0], '--base', 'HEAD']);
  assert.notStrictEqual(r.status, 0, '--base takes the plugin hooks only');
  r = run(['--hook', 'expansion.js', '--base', 'no-such-ref-xyz']);
  assert.notStrictEqual(r.status, 0, 'a bad ref fails the replay');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('replay-wordsplit-guard: all checks passed');
