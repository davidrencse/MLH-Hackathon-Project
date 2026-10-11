import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test('host serves routes, demo credits, and a working API without exposing connected runtimes', { timeout: 30_000 }, async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const data = await mkdtemp(resolve(tmpdir(), 'slop-host-test-'));
  const env = { ...process.env, PORT: '18080', GHOSTGRID_DATA_DIR: data };
  for (const key of ['DEEPSEEK_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key];
  const child = spawn(process.execPath, ['scripts/host.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const base = 'http://127.0.0.1:18080';
  const post = (path, body) => fetch(base + '/gg' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(log);
      ready = await fetch(base + '/health').then(r => r.ok).catch(() => false);
      if (ready) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(ready, true, log);
    for (const path of ['/', '/dashboard/agents', '/office/claude']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200); assert.match(await response.text(), /<html/);
    }
    assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
    const credits = await fetch(base + '/gg/api/v1/provider-credits').then(r => r.json());
    assert.equal(credits.rows.length, 3);
    assert.ok(credits.rows.every(row => row.demo && row.demoTokens === 100_000 && row.balanceUsd === undefined));
    assert.equal((await post('/api/v1/providers', { name: 'Connected', type: 'openai-compatible', baseUrl: 'http://127.0.0.1' })).status, 403);
    assert.equal((await post('/api/v1/office/workers', {})).status, 409);
    const providerResponse = await post('/api/v1/providers', { name: 'Demo Runtime', type: 'mock' });
    assert.equal(providerResponse.status, 201); const provider = await providerResponse.json();
    const projectResponse = await post('/api/v1/projects', { name: 'Demo City' });
    assert.equal(projectResponse.status, 201); const project = await projectResponse.json();
    const agentResponse = await post('/api/v1/agents', { name: 'Claude', buildingId: 'claude', projectId: project.id, providerId: provider.id });
    assert.equal(agentResponse.status, 201); const agent = await agentResponse.json();
    const taskResponse = await post('/api/v1/tasks', { projectId: project.id, agentId: agent.id, prompt: 'Hello city' });
    assert.equal(taskResponse.status, 202); const task = await taskResponse.json();
    let finished;
    for (let i = 0; i < 30; i++) {
      finished = await fetch(base + '/gg/api/v1/tasks/' + task.id).then(r => r.json());
      if (finished.status === 'completed') break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(finished.status, 'completed');
    const usage = await fetch(base + '/gg/api/v1/usage/summary').then(r => r.json());
    assert.equal(usage.totals.requests, 1);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(r => child.once('exit', r));
    await rm(data, { recursive: true, force: true });
  }
});
