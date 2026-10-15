import { describe, expect, it } from "vitest";
import { redact, registerSecret } from "../src/security/index.js";

// redact() caches the secret list per environment (it runs on every SSE event, and rebuilding
// the list was most of its cost). A cache in a redactor is a leak waiting to happen: anything
// that changes the secret set after the first call must invalidate it, or a key reaches a
// response or a log in the clear. One case each for registration, addition, reassignment and a
// swap that leaves the key count unchanged — that last one is invisible to a size check alone.
describe("redact cache invalidation", () => {
  it("scrubs a secret registered AFTER the cache was built", () => {
    const env = { FOO: "bar" } as NodeJS.ProcessEnv;
    expect(redact("hello", env)).toBe("hello"); // builds the cache
    registerSecret("sk-registered-late-9f2a");
    expect(redact("token sk-registered-late-9f2a here", env)).toBe("token [REDACTED] here");
  });

  it("scrubs an env secret ADDED after the cache was built", () => {
    const env = { FOO: "bar" } as NodeJS.ProcessEnv;
    redact("warm", env);
    env.STRIPE_API_KEY = "sk-env-added-7c31";
    expect(redact("leak sk-env-added-7c31", env)).toBe("leak [REDACTED]");
  });

  it("scrubs the NEW value when an env secret is reassigned", () => {
    const env = { OPENAI_API_KEY: "sk-old-value-1111" } as NodeJS.ProcessEnv;
    expect(redact("sk-old-value-1111", env)).toBe("[REDACTED]");
    env.OPENAI_API_KEY = "sk-new-value-2222";
    expect(redact("sk-new-value-2222", env)).toBe("[REDACTED]");
  });

  it("handles a swap that keeps the key count identical", () => {
    // One key removed and another added in the same tick: `size` alone cannot see this.
    const env = { A_TOKEN: "tok-aaaa-1111", B: "plain" } as NodeJS.ProcessEnv;
    redact("warm", env);
    delete env.A_TOKEN;
    env.C_TOKEN = "tok-cccc-3333";
    expect(redact("tok-cccc-3333", env)).toBe("[REDACTED]");
  });

  it("scrubs a secret added while a plain variable is removed in the same tick", () => {
    // The narrow case a key-count guard cannot see: the count is unchanged and no tracked
    // name changed value, yet a new secret has appeared. This leaked until secretsFor()
    // compared the secret-shaped key names themselves.
    const env = { PLAIN: "nothing", OTHER_KEY: "sk-tracked-1111" } as NodeJS.ProcessEnv;
    expect(redact("sk-tracked-1111", env)).toBe("[REDACTED]");
    delete env.PLAIN;
    env.NEW_API_KEY = "sk-should-be-hidden-9999";
    expect(redact("sk-should-be-hidden-9999", env)).toBe("[REDACTED]");
  });

  it("scrubs a tracked variable that was empty when the cache was built", () => {
    const env = { LATE_API_KEY: "" } as NodeJS.ProcessEnv;
    redact("warm", env);
    env.LATE_API_KEY = "sk-filled-in-later-4242";
    expect(redact("sk-filled-in-later-4242", env)).toBe("[REDACTED]");
  });

  it("keeps scrubbing a secret that moved to a differently-named key", () => {
    // The value is what leaks, not the name it arrived under.
    const env = { FIRST_KEY: "sk-moves-around-5555" } as NodeJS.ProcessEnv;
    redact("warm", env);
    delete env.FIRST_KEY;
    env.SECOND_KEY = "sk-moves-around-5555";
    expect(redact("sk-moves-around-5555", env)).toBe("[REDACTED]");
  });

  it("starts scrubbing a value that grows past the minimum length", () => {
    // Values under 4 characters are not treated as secrets; one that grows past that floor has
    // to be picked up, the same as a variable that was empty at build time.
    const env = { TINY_KEY: "ab" } as NodeJS.ProcessEnv;
    redact("warm", env);
    env.TINY_KEY = "sk-now-long-enough-7777";
    expect(redact("sk-now-long-enough-7777", env)).toBe("[REDACTED]");
  });

  it("keeps one environment's secrets out of another's cache", () => {
    // The cache is keyed per environment object; registered secrets are global to the process.
    const a = { A_KEY: "sk-env-a-1234" } as NodeJS.ProcessEnv;
    const b = { B_KEY: "sk-env-b-5678" } as NodeJS.ProcessEnv;
    expect(redact("sk-env-a-1234", a)).toBe("[REDACTED]");
    expect(redact("sk-env-a-1234", b)).toBe("sk-env-a-1234");
    registerSecret("sk-global-9012");
    expect(redact("sk-global-9012", b)).toBe("[REDACTED]");
  });

  it("keeps scrubbing the longest match first", () => {
    const env = { X_KEY: "abcd", Y_KEY: "abcdefgh" } as NodeJS.ProcessEnv;
    expect(redact("abcdefgh", env)).toBe("[REDACTED]");
  });
});
