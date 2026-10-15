import { mkdirSync, mkdtempSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localCliUsage } from '../src/providers/localCliUsage.js';

/** A fresh pair of CLI homes per test, so each one gets its own file cache keyed by path. */
function homes() {
  const root = mkdtempSync(join(tmpdir(), 'ghostgrid-cli-usage-'));
  const claude = join(root, 'claude');
  const codex = join(root, 'codex');
  vi.stubEnv('GHOSTGRID_CLAUDE_HOME', claude);
  vi.stubEnv('GHOSTGRID_CODEX_HOME', codex);
  vi.stubEnv('GHOSTGRID_LOCAL_CLI_USAGE', '1');
  return { claude, codex };
}

const claudeResponse = (id: string, over: Record<string, unknown> = {}) => JSON.stringify({
  type: 'assistant', requestId: `req_${id}`, timestamp: '2026-10-13T00:00:00.000Z',
  message: { id, model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } },
  ...over,
});

const codexUsage = (responseId: string, turn = 't1') => JSON.stringify({
  type: 'token_usage_record', timestamp: '2026-10-13T00:00:00.000Z',
  payload: { turn_id: turn, response_id: responseId, usage: { input_tokens: 1000, cached_input_tokens: 800, cache_write_input_tokens: 0, output_tokens: 50 } },
});

function writeClaude(claude: string, lines: string[]) {
  const dir = join(claude, 'projects', '-home-user-repo');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function writeCodex(codex: string, lines: string[]) {
  const dir = join(codex, 'sessions', '2026', '10', '13');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'rollout.jsonl');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

afterEach(() => vi.unstubAllEnvs());

describe('local CLI usage', () => {
  it('reports nothing when neither CLI has transcripts', async () => {
    homes();
    expect(await localCliUsage(true)).toEqual([]);
  });

  it('is off when disabled', async () => {
    const { claude } = homes();
    writeClaude(claude, [claudeResponse('msg_1')]);
    vi.stubEnv('GHOSTGRID_LOCAL_CLI_USAGE', '0');
    expect(await localCliUsage(true)).toEqual([]);
  });

  it('counts each Claude Code response once and skips locally generated entries', async () => {
    const { claude } = homes();
    writeClaude(claude, [
      claudeResponse('msg_1'),
      // The same response re-logged: a second count here would double every tool-using turn.
      claudeResponse('msg_1'),
      claudeResponse('msg_2'),
      claudeResponse('msg_3', { message: { id: 'msg_3', model: '<synthetic>', usage: { input_tokens: 9, output_tokens: 9 } } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    ]);
    const [row] = (await localCliUsage(true));
    expect(row.provider).toBe('claude-code');
    expect(row.source).toBe('local-cli');
    expect(row.requests).toBe(2);
    expect(row.inputTokens).toBe(20);
    expect(row.outputTokens).toBe(10);
    expect(row.cacheReadTokens).toBe(200);
    expect(row.cacheWriteTokens).toBe(40);
    expect(row.tokensUsed).toBe(270);
    expect(row.models).toEqual([{ model: 'claude-opus-5', tokens: 270, requests: 2 }]);
    // A subscription has no balance and no per-request price to report.
    expect(row.balanceUsd).toBeUndefined();
    expect(row.reportedCostUsd).toBeUndefined();
  });

  it('adds only the responses appended since the last read', async () => {
    const { claude } = homes();
    const file = writeClaude(claude, [claudeResponse('msg_1')]);
    expect((await localCliUsage(true))[0].requests).toBe(1);
    appendFileSync(file, `${claudeResponse('msg_2')}\n`);
    const [row] = (await localCliUsage(true));
    expect(row.requests).toBe(2);
    expect(row.tokensUsed).toBe(270);
  });

  it('ignores a half-written line until it is complete', async () => {
    const { claude } = homes();
    const file = writeClaude(claude, [claudeResponse('msg_1')]);
    const partial = claudeResponse('msg_2');
    appendFileSync(file, partial.slice(0, 40));
    expect((await localCliUsage(true))[0].requests).toBe(1);
    appendFileSync(file, `${partial.slice(40)}\n`);
    expect((await localCliUsage(true))[0].requests).toBe(2);
  });

  it('starts over when a transcript is rewritten shorter', async () => {
    const { claude } = homes();
    writeClaude(claude, [claudeResponse('msg_1'), claudeResponse('msg_2')]);
    expect((await localCliUsage(true))[0].requests).toBe(2);
    writeClaude(claude, [claudeResponse('msg_9')]);
    expect((await localCliUsage(true))[0].requests).toBe(1);
  });

  it('reads Codex responses, their model, and the plan windows', async () => {
    const { codex } = homes();
    writeCodex(codex, [
      JSON.stringify({ type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-6.1-sol' } }),
      codexUsage('resp_1'),
      codexUsage('resp_1'),
      codexUsage('resp_2'),
      JSON.stringify({
        type: 'event_msg', timestamp: '2026-10-13T00:00:01.000Z',
        payload: { type: 'token_count', rate_limits: { plan_type: 'plus', primary: { used_percent: 42, window_minutes: 300, resets_at: 1791836260 }, secondary: null } },
      }),
      // A later report with no windows at all says nothing, so the one above has to survive it.
      JSON.stringify({
        type: 'event_msg', timestamp: '2026-10-13T00:00:02.000Z',
        payload: { type: 'token_count', rate_limits: { plan_type: 'plus', primary: null, secondary: null } },
      }),
    ]);
    const [row] = (await localCliUsage(true));
    expect(row.provider).toBe('codex-cli');
    expect(row.requests).toBe(2);
    // Codex counts the cached part inside input_tokens; the row splits it back out.
    expect(row.inputTokens).toBe(400);
    expect(row.cacheReadTokens).toBe(1600);
    expect(row.outputTokens).toBe(100);
    expect(row.tokensUsed).toBe(2100);
    expect(row.plan).toBe('plus');
    expect(row.windows).toEqual([{ label: '5H', usedPercent: 42, resetsAt: new Date(1791836260 * 1000).toISOString() }]);
    expect(row.models).toEqual([{ model: 'gpt-6.1-sol', tokens: 2100, requests: 2 }]);
  });

  it('reads a transcript larger than one chunk without losing or corrupting a line', async () => {
    // The reader walks a file 8MB at a time so the scan never blocks the event loop. A line —
    // and a multi-byte character inside it — can therefore straddle a chunk boundary, which is
    // why only whole lines are ever decoded. Padding pushes the real entries across one.
    const { claude } = homes();
    const padding = JSON.stringify({ type: 'user', message: { role: 'user', content: '✦'.repeat(400) } });
    const lines: string[] = [];
    for (let i = 0; lines.length * padding.length < 9 * 1024 * 1024; i++) lines.push(padding);
    lines.splice(Math.floor(lines.length / 2), 0, claudeResponse('msg_mid'));
    lines.push(claudeResponse('msg_last'));
    writeClaude(claude, lines);
    const [row] = (await localCliUsage(true));
    expect(row.requests).toBe(2);
    expect(row.tokensUsed).toBe(270);
  });

  it('reports both CLIs when both have transcripts', async () => {
    const { claude, codex } = homes();
    writeClaude(claude, [claudeResponse('msg_1')]);
    writeCodex(codex, [codexUsage('resp_1')]);
    expect((await localCliUsage(true)).map((r) => r.provider)).toEqual(['claude-code', 'codex-cli']);
  });
});
