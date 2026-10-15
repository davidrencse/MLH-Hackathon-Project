import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  WALL_STREET_ROSTER,
  WallStreetService,
} from "../src/wallstreet/service.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const repoPayload = (stars: number) => ({
  description: "Free, open source crypto trading bot",
  language: "Python",
  stargazers_count: stars,
  forks_count: 7000,
  open_issues_count: 42,
  subscribers_count: 600,
  topics: ["trading-bot", "cryptocurrency", 7],
  license: { spdx_id: "GPL-3.0" },
  pushed_at: "2026-10-01T10:00:00Z",
  homepage: "https://www.freqtrade.io",
});

function fakeFetch(
  handler: (url: string) => Response | Promise<Response>,
  calls: string[] = [],
) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function setup(wallStreet: WallStreetService) {
  const dir = mkdtempSync(join(tmpdir(), "ghostgrid-wallstreet-"));
  const instance = await buildApp({
    config: loadConfig({ GHOSTGRID_DATA_DIR: dir }),
    logger: false,
    startWorker: false,
    wallStreet,
  });
  cleanups.push(async () => {
    await instance.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return instance.app;
}

describe("Wall Street district", () => {
  it("serves every roster building enriched with GitHub metadata", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok(repoPayload(31000)));
    const app = await setup(new WallStreetService({ fetchImpl }));

    const response = await app.inject({ method: "GET", url: "/api/v1/wallstreet" });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.district).toBe("Wall Street");
    expect(body.source).toBe("github");
    expect(body.buildings).toHaveLength(WALL_STREET_ROSTER.length);
    expect(calls).toHaveLength(WALL_STREET_ROSTER.length);

    const freqtrade = body.buildings.find((b: any) => b.slug === "freqtrade");
    expect(freqtrade.url).toBe("https://github.com/freqtrade/freqtrade");
    expect(freqtrade.status).toBe("live");
    expect(freqtrade.stats.stars).toBe(31000);
    expect(freqtrade.stats.license).toBe("GPL-3.0");
    // non-string topics are dropped rather than passed through
    expect(freqtrade.stats.topics).toEqual(["trading-bot", "cryptocurrency"]);
  });

  it("gives every building a lot, an accent and a distinct slug", () => {
    const slugs = WALL_STREET_ROSTER.map((seed) => seed.slug);
    const lots = WALL_STREET_ROSTER.map((seed) => seed.lot);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(lots).size).toBe(lots.length);
    for (const seed of WALL_STREET_ROSTER) {
      expect(seed.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(seed.short.length).toBeLessThanOrEqual(10);
      expect(seed.repo.owner).toBeTruthy();
    }
  });

  it("caches reads so the district does not spend the GitHub rate limit per view", async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok(repoPayload(10)));
    const service = new WallStreetService({ fetchImpl });

    const first = await service.list();
    const second = await service.list();

    expect(calls).toHaveLength(WALL_STREET_ROSTER.length);
    expect(first.buildings[0].status).toBe("live");
    expect(second.buildings[0].status).toBe("cached");
    expect(second.buildings[0].stats?.stars).toBe(10);

    const refreshed = await service.list({ refresh: true });
    expect(calls).toHaveLength(WALL_STREET_ROSTER.length * 2);
    expect(refreshed.buildings[0].status).toBe("live");
  });

  it("falls back to the static roster when GitHub is unreachable", async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    });
    const app = await setup(new WallStreetService({ fetchImpl }));

    const response = await app.inject({ method: "GET", url: "/api/v1/wallstreet" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.source).toBe("static");
    expect(body.buildings).toHaveLength(WALL_STREET_ROSTER.length);
    for (const building of body.buildings) {
      expect(building.status).toBe("static");
      expect(building.stats).toBeNull();
      expect(building.strategy).toBeTruthy();
      expect(building.error).toBeTruthy();
    }
  });

  it("serves a rate-limited repository from cache instead of failing", async () => {
    let limited = false;
    const { fetchImpl } = fakeFetch(() =>
      limited
        ? new Response("rate limited", { status: 403 })
        : ok(repoPayload(99)),
    );
    const service = new WallStreetService({ fetchImpl, cacheTtlMs: 0 });

    expect((await service.list()).buildings[0].status).toBe("live");
    limited = true;
    const degraded = await service.list();
    expect(degraded.buildings[0].status).toBe("cached");
    expect(degraded.buildings[0].stats?.stars).toBe(99);
    expect(degraded.buildings[0].error).toContain("rate limit");
  });

  it("looks a single building up by slug and 404s on anything else", async () => {
    const { fetchImpl } = fakeFetch(() => ok(repoPayload(5)));
    const app = await setup(new WallStreetService({ fetchImpl }));

    const one = await app.inject({ method: "GET", url: "/api/v1/wallstreet/lean" });
    expect(one.statusCode).toBe(200);
    expect(one.json().repo).toEqual({ owner: "QuantConnect", name: "Lean" });

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/wallstreet/not-a-building",
    });
    expect(missing.statusCode).toBe(404);
  });
});
