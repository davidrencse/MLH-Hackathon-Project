import { CodexAdapter } from "./codex.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";
import { BROWSER_SITE_BY_TYPE, BrowserSessionAdapter } from "./browser-session.js";
import { MockAdapter } from "./mock.js";
import {
  ProviderError,
  type ProviderAdapter,
  type ProviderConfig,
} from "./types.js";
export class ProviderRegistry {
  private readonly factories = new Map<
    ProviderConfig["type"],
    (config: ProviderConfig) => ProviderAdapter
  >([
    ["mock", () => new MockAdapter()],
    ["codex", (c) => new CodexAdapter(c)],
    ["claude", (c) => new ClaudeAdapter(c)],
    ["deepseek", (c) => new OpenAICompatibleAdapter(c)],
    ["openai-compatible", (c) => new OpenAICompatibleAdapter(c)],
    ...(Object.entries(BROWSER_SITE_BY_TYPE) as [ProviderConfig["type"], (typeof BROWSER_SITE_BY_TYPE)[string]][]).map(
      ([type, site]) =>
        [type, (c: ProviderConfig) => new BrowserSessionAdapter(c, site)] as [
          ProviderConfig["type"],
          (config: ProviderConfig) => ProviderAdapter,
        ],
    ),
  ]);
  register(
    type: ProviderConfig["type"],
    factory: (config: ProviderConfig) => ProviderAdapter,
  ) {
    this.factories.set(type, factory);
  }
  get(config: ProviderConfig): ProviderAdapter {
    const factory = this.factories.get(config.type);
    if (!factory)
      throw new ProviderError(`Unsupported provider type: ${config.type}`);
    return factory(config);
  }
}
