import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredits, vendorOf, withRecordedUsage, type UsageProviderRow } from '../src/providers/credits.js';

const usageRow = (over: Partial<UsageProviderRow>): UsageProviderRow => ({
  providerId: 'p1', name: 'Provider', type: null, baseUrl: null, requests: 1,
  inputTokens: 0, outputTokens: 0, reportedCostUsd: 0, estimatedCostUsd: 0,
  unknownCostRequests: 0, unknownTokenRequests: 0, ...over,
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('provider credits', () => {
  it('reports a missing key as nokey without inventing an allowance and makes no requests', async () => {
    for (const key of ['DEEPSEEK_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY']) vi.stubEnv(key, '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const credits = new ProviderCredits();
    const result = await credits.read();
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.status).toBe('nokey');
      expect(row.balanceUsd).toBeUndefined();
    }
    expect(await credits.read()).toBe(result);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves a live balance while reporting a rejected provider as an error', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key'); vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('deepseek')
      ? new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '12.34' }] }))
      : new Response('{}', { status: 401 })));
    const result = await new ProviderCredits().read();
    expect(result.rows[0]).toMatchObject({ status: 'ok', balanceUsd: 12.34 });
    expect(result.rows[1]).toMatchObject({ status: 'error', detail: 'HTTP 401' });
  });
  it('does not invent zero quota when successful responses lack rate-limit headers', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', ''); vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const result = await new ProviderCredits().read();
    expect(result.rows[1]).toMatchObject({ status: 'unsupported' });
    expect(result.rows[1].quota).toBeUndefined();
  });
});

describe('vendorOf', () => {
  it('prefers the base URL host over the provider type', () => {
    expect(vendorOf('openai-compatible', 'https://api.groq.com/openai/v1')).toBe('groq');
    expect(vendorOf('openai-compatible', 'https://api.deepseek.com')).toBe('deepseek');
    expect(vendorOf('claude', undefined)).toBe('anthropic');
    expect(vendorOf('codex', null)).toBe('openai');
    expect(vendorOf('mock', null)).toBeNull();
    expect(vendorOf('openai-compatible', 'not a url')).toBeNull();
  });
});

describe('withRecordedUsage', () => {
  it('attaches recorded tokens to the vendor row that spent them', () => {
    const rows = withRecordedUsage(
      [{ provider: 'anthropic', status: 'unsupported' }, { provider: 'groq', status: 'nokey' }],
      [
        usageRow({ type: 'claude', inputTokens: 1200, outputTokens: 300, reportedCostUsd: 0.5, requests: 2 }),
        usageRow({ providerId: 'p2', type: 'claude-browser', inputTokens: 100, outputTokens: 50, requests: 1 }),
      ],
    );
    expect(rows[0]).toMatchObject({
      provider: 'anthropic', tokensUsed: 1650, inputTokens: 1300, outputTokens: 350,
      requests: 3, reportedCostUsd: 0.5,
    });
    expect(rows[1]).toMatchObject({ provider: 'groq', tokensUsed: 0, requests: 0 });
  });
  it('keeps usage from providers with no known vendor as its own row', () => {
    const rows = withRecordedUsage([], [usageRow({ type: 'mock', name: 'Mock engine', inputTokens: 7, outputTokens: 3 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'mock', name: 'Mock engine', tokensUsed: 10, status: 'unsupported' });
  });
  it('reports zeroed usage rather than nothing when no records exist', () => {
    const rows = withRecordedUsage([{ provider: 'deepseek', status: 'ok', balanceUsd: 3 }]);
    expect(rows[0]).toMatchObject({ provider: 'deepseek', balanceUsd: 3, tokensUsed: 0, requests: 0, unknownCostRequests: 0 });
  });
});

describe('withRecordedUsage vendor rows', () => {
  it('adds a row for a vendor with usage but no balance row', () => {
    const rows = withRecordedUsage(
      [{ provider: 'deepseek', status: 'nokey' }],
      [usageRow({ type: 'codex', inputTokens: 40, outputTokens: 10, requests: 2 })],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ provider: 'openai', tokensUsed: 50, requests: 2, status: 'unsupported' });
  });
});
