import type { Usage } from "./types.js";

/**
 * Token accounting shared by every adapter.
 *
 * Two rules hold everywhere: a count we did not receive stays `null` (never 0, which
 * would read as "this request was free"), and a count we did receive is never dropped
 * just because the task later failed or was cancelled — those tokens were still spent.
 */
export const knownCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const count = (value: unknown): number | null =>
  knownCount(value) ? value : null;

/** Normalizes any adapter-shaped usage into the recorded contract. */
export function normalizeUsage(usage: Partial<Usage> | null | undefined): Usage {
  return {
    inputTokens: count(usage?.inputTokens),
    outputTokens: count(usage?.outputTokens),
    cachedInputTokens: count(usage?.cachedInputTokens),
    costUsd: count(usage?.costUsd),
  };
}

/** True when at least one real number was reported. */
export function hasAnyUsage(usage: Usage | null | undefined): boolean {
  if (!usage) return false;
  return [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.costUsd]
    .some((value) => knownCount(value));
}

/**
 * Later usage wins per field, but a missing later field never erases a known earlier
 * one. OpenAI-compatible streams send `usage: null` on every content chunk and the real
 * numbers only on the final one; some gateways send a partial object on both.
 */
export function mergeUsage(base: Usage, next: Partial<Usage> | null | undefined): Usage {
  if (!next) return base;
  const pick = (a: unknown, b: number | null) => (knownCount(a) ? a : b);
  return {
    inputTokens: pick(next.inputTokens, base.inputTokens),
    outputTokens: pick(next.outputTokens, base.outputTokens),
    cachedInputTokens: pick(next.cachedInputTokens, base.cachedInputTokens ?? null),
    costUsd: pick(next.costUsd, base.costUsd ?? null),
  };
}

/**
 * Adds two partial readings, for providers that report per model call rather than per
 * task. A field neither side reported stays null; a field only one side reported keeps
 * that side's number rather than being zeroed by the other's silence.
 */
export function sumUsage(base: Usage, next: Partial<Usage> | null | undefined): Usage {
  if (!next) return base;
  const add = (a: number | null | undefined, b: unknown) => {
    if (!knownCount(a) && !knownCount(b)) return null;
    return (knownCount(a) ? a : 0) + (knownCount(b) ? b : 0);
  };
  return {
    inputTokens: add(base.inputTokens, next.inputTokens),
    outputTokens: add(base.outputTokens, next.outputTokens),
    cachedInputTokens: add(base.cachedInputTokens, next.cachedInputTokens),
    costUsd: add(base.costUsd, next.costUsd),
  };
}

/**
 * Completes one side of the token split from a reported total. Vendors that only send
 * `total_tokens` plus one half still carry enough to recover the other half exactly.
 */
export function completeFromTotal(usage: Usage, total: unknown): Usage {
  if (!knownCount(total)) return usage;
  if (usage.inputTokens === null && knownCount(usage.outputTokens) && total >= usage.outputTokens)
    return { ...usage, inputTokens: total - usage.outputTokens };
  if (usage.outputTokens === null && knownCount(usage.inputTokens) && total >= usage.inputTokens)
    return { ...usage, outputTokens: total - usage.inputTokens };
  return usage;
}

export const emptyUsage = (): Usage => ({
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  costUsd: null,
});

/**
 * Carries the tokens an attempt already spent out through its failure. Attached
 * non-enumerably so it never reaches a serialized error payload; the execution engine
 * reads it back with {@link usageFromError} and records it before failing the task.
 */
export function attachUsage<E>(error: E, usage: Usage | null | undefined): E {
  if (!hasAnyUsage(usage) || !(error instanceof Error)) return error;
  // An inner frame knew more precisely what was spent; an outer one must not overwrite it.
  if (usageFromError(error)) return error;
  Object.defineProperty(error, "usage", {
    value: normalizeUsage(usage),
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return error;
}

export function usageFromError(error: unknown): Usage | null {
  const usage = (error as { usage?: unknown } | null)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const normalized = normalizeUsage(usage as Partial<Usage>);
  return hasAnyUsage(normalized) ? normalized : null;
}
