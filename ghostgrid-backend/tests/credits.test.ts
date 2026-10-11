import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderCredits } from '../src/providers/credits.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('provider credits', () => {
  it('returns clearly marked demo tokens without keys and makes no requests', async () => {
    for (const key of ['DEEPSEEK_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY']) vi.stubEnv(key, '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const credits = new ProviderCredits();
    const result = await credits.read();
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.demo).toBe(true);
      expect(row.demoTokens).toBe(100_000);
      expect(row.balanceUsd).toBeUndefined();
    }
    expect(await credits.read()).toBe(result);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves a live balance while falling back for a rejected provider', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key'); vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('deepseek')
      ? new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '12.34' }] }))
      : new Response('{}', { status: 401 })));
    const result = await new ProviderCredits().read();
    expect(result.rows[0]).toMatchObject({ status: 'ok', balanceUsd: 12.34 });
    expect(result.rows[0].demo).toBeUndefined();
    expect(result.rows[1]).toMatchObject({ demo: true, demoTokens: 100_000 });
  });
  it('does not invent zero quota when successful responses lack rate-limit headers', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', ''); vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const result = await new ProviderCredits().read();
    expect(result.rows[1]).toMatchObject({ demo: true, status: 'unsupported' });
    expect(result.rows[1].quota).toBeUndefined();
  });
});
