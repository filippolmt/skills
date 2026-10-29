#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';

import { hasWarning } from './codex-smoke-warnings.js';
const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});
const closed = new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', (code, signal) => resolve({ code, signal }));
});
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const waiters = new Map();
const timer = setTimeout(() => child.kill(), 20_000);
let stdoutWarning = false;

lines.on('line', (line) => {
  if (hasWarning(line)) {
    stdoutWarning = true;
    process.stderr.write(`${line}\n`);
  }
  const message = JSON.parse(line);
  const waiter = waiters.get(message.id);
  if (waiter) {
    waiters.delete(message.id);
    waiter(message);
  }
});

function request(id, method, params) {
  return new Promise((resolve) => {
    waiters.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

try {
  const initialized = await request(1, 'initialize', {
    clientInfo: { name: 'filippo-skills-hook-smoke', version: '1' },
    capabilities: { experimentalApi: true },
  });
  assert.ok(initialized.result?.codexHome);
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);

  const response = await request(2, 'hooks/list', { cwds: [process.cwd()] });
  const hooks = response.result?.data?.[0]?.hooks || [];
  const impeccable = hooks.filter((hook) => hook.pluginId === 'impeccable@filippo-skills');
  assert.deepEqual(impeccable.map((hook) => hook.eventName).sort(), ['postToolUse', 'stop']);
  assert.ok(impeccable.every((hook) => hook.source === 'plugin' && hook.enabled));
  assert.ok(impeccable.every((hook) => hook.trustStatus === 'untrusted'));

  const postToolUse = impeccable.find((hook) => hook.eventName === 'postToolUse');
  const execution = spawnSync('/bin/sh', ['-c', postToolUse.command], {
    cwd: process.cwd(),
    input: JSON.stringify({
      hook_event_name: 'PostToolUse',
      session_id: 'smoke',
      cwd: process.cwd(),
      tool_name: 'apply_patch',
      tool_input: { file_path: '/tmp/nonexistent-smoke.tsx' },
    }),
    encoding: 'utf8',
  });
  process.stderr.write(execution.stderr || '');
  assert.equal(execution.status, 0, execution.stderr);
  assert.ok(!hasWarning(execution.stderr) && !hasWarning(execution.stdout), `Codex hook command emitted a warning: ${execution.stdout}`);
} finally {
  clearTimeout(timer);
  child.stdin.end();
  child.kill();
  const { code, signal } = await closed;
  assert.ok(code === 0 || (code === null && signal === 'SIGTERM'), `Codex app-server exited with ${code ?? signal}`);
  assert.ok(!stdoutWarning && !hasWarning(stderr), 'Codex app-server emitted a warning');
}
console.log('Codex hook smoke passed: discovery, trust gate, and command execution verified.');
