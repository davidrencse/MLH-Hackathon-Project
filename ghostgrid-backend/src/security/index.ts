import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
export function assertWorkspace(
  workspace: string,
  allowedWorkspaces: string[],
): string {
  if (typeof workspace !== "string" || !workspace || workspace.includes("\0"))
    throw Object.assign(new Error("Invalid workspace path"), { statusCode: 400 });
  let target: string;
  try { target = realpathSync(resolve(workspace)); }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
      throw Object.assign(new Error("Workspace must exist"), { statusCode: 400 });
    throw error;
  }
  const allowed = allowedWorkspaces.some((root) => {
    // An allowlist entry that no longer resolves denies only itself: one stale
    // root must not turn every workspace check into a 500.
    let base: string;
    try { base = realpathSync(resolve(root)); }
    catch (error) {
      if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return false;
      throw error;
    }
    const rel = relative(base, target);
    return (
      rel === "" ||
      (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
    );
  });
  if (!allowed)
    throw Object.assign(
      new Error("Workspace is outside the configured allowlist"),
      { statusCode: 403 },
    );
  return target;
}
export const validateWorkspace = assertWorkspace;
export function safePath(root: string, path: string): string {
  if (typeof path !== "string" || path.includes("\0"))
    throw Object.assign(new Error("Invalid filesystem path"), { statusCode: 400 });
  if (isAbsolute(path))
    throw Object.assign(new Error("Absolute artifact paths are forbidden"), {
      statusCode: 400,
    });
  const base = realpathSync(root);
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw Object.assign(new Error("Path escapes workspace"), {
      statusCode: 403,
    });
  // Resolve existing paths to reject symlinks; callers writing new paths must validate their parent too.
  let actual: string;
  try {
    actual = realpathSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // realpath reports ENOENT for dangling symlinks too. Never treat those as
    // ordinary new paths: a later write would follow the link outside the root.
    let component = base;
    for (const part of rel.split(sep).filter(Boolean)) {
      component = resolve(component, part);
      try {
        if (lstatSync(component).isSymbolicLink()) {
          const actualComponent = realpathSync(component);
          const componentRel = relative(base, actualComponent);
          if (componentRel === ".." || componentRel.startsWith(`..${sep}`) || isAbsolute(componentRel))
            throw Object.assign(new Error("Symlink escapes workspace"), { statusCode: 403 });
        }
      } catch (componentError) {
        if ((componentError as NodeJS.ErrnoException).code !== "ENOENT") throw componentError;
        // Distinguish a missing directory/file from an existing broken link.
        try {
          if (lstatSync(component).isSymbolicLink())
            throw Object.assign(new Error("Dangling symlink is forbidden"), { statusCode: 403 });
        } catch (linkError) {
          if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError;
        }
        break;
      }
    }
    let parent = dirname(target);
    while (true) {
      try {
        const actualParent = realpathSync(parent);
        const parentRel = relative(base, actualParent);
        if (
          parentRel === ".." ||
          parentRel.startsWith(`..${sep}`) ||
          isAbsolute(parentRel)
        )
          throw Object.assign(new Error("Parent symlink escapes workspace"), { statusCode: 403 });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const next = dirname(parent);
        if (next === parent) throw error;
        parent = next;
      }
    }
    return target;
  }
  const realRel = relative(base, actual);
  if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel))
    throw Object.assign(new Error("Symlink escapes workspace"), {
      statusCode: 403,
    });
  return actual;
}
const registeredSecrets = new Set<string>();
/** Bumped whenever the registered set changes, so every cached list rebuilds. */
let secretsRevision = 0;
export function registerSecret(value: string | undefined): void {
  if (!value || registeredSecrets.has(value)) return;
  registeredSecrets.add(value);
  secretsRevision++;
}

const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;

interface SecretCache {
  revision: number;
  /** every secret-shaped env var name, in enumeration order, and the values they held */
  names: string[];
  values: (string | undefined)[];
  secrets: string[];
}
// Keyed by the environment object, so a test passing its own env never shares the
// process cache.
const secretCaches = new WeakMap<NodeJS.ProcessEnv, SecretCache>();

/**
 * The secrets to scrub, cached per environment.
 *
 * Rebuilding this list was 90% of every `redact()` call — 106µs of 118µs on an 86-variable
 * environment — and `redact` runs on every response and on every event the SSE loop writes,
 * up to 500 per 250ms tick. Caching it takes the call to 54µs.
 *
 * Invalidation is exact, and deliberately so: a stale list here puts an API key into a
 * response or a log in the clear. The revision counter covers `registerSecret`; comparing the
 * secret-shaped key names covers one appearing, disappearing or being swapped for another;
 * re-reading their values covers a reassignment. See tests/redact-cache.test.ts.
 *
 * Most of what is left is `Object.keys(env)`: `process.env` is host-backed, so enumerating it
 * copies the whole environment block (a plain object costs 0.2µs). A cheaper guard — the key
 * count alone — is what the first version used, and it missed a tick that drops one plain
 * variable while adding one key. Redaction is a security guarantee; it does not get traded for
 * the difference.
 */
function secretsFor(env: NodeJS.ProcessEnv): string[] {
  // Name every secret-shaped variable on each call. Testing the keys costs 4µs on top of the
  // enumeration we already pay, and it is the only way to see a secret-shaped variable that
  // *appeared*: a guard on the key count misses a tick that drops one plain variable and adds
  // one key, which is a new secret going out unscrubbed.
  const names: string[] = [];
  for (const key of Object.keys(env)) if (SECRET_KEY.test(key)) names.push(key);

  const cached = secretCaches.get(env);
  if (cached && cached.revision === secretsRevision && cached.names.length === names.length) {
    let stale = false;
    for (let i = 0; i < names.length; i++)
      if (cached.names[i] !== names[i] || env[names[i]] !== cached.values[i]) {
        stale = true;
        break;
      }
    if (!stale) return cached.secrets;
  }

  const values = names.map((name) => env[name]);
  // A variable only carries a secret once it holds something worth hiding; it stays tracked
  // either way, so filling in an empty one later still invalidates this.
  const fromEnv = values.filter((value): value is string => !!value && value.length >= 4);
  // Longest first: a short secret that is a substring of a longer one must not blank out the
  // part that would otherwise identify the longer one.
  const secrets = [...registeredSecrets, ...fromEnv].sort((a, b) => b.length - a.length);
  secretCaches.set(env, { revision: secretsRevision, names, values, secrets });
  return secrets;
}

export function redact<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  const secrets = secretsFor(env);
  const walk = (input: any): any => {
    if (typeof input === "string") {
      let text = input;
      for (const secret of secrets)
        text = text.split(secret).join("[REDACTED]");
      return text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
    }
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [
          key,
          /^(?:api[-_]?key|(?:proxy[-_]?)?authorization|password|secret|(?:access|refresh|id)[-_]?token|token|client[-_]?secret|private[-_]?key|cookie|set-cookie)$/i.test(key)
            ? "[REDACTED]"
            : walk(item),
        ]),
      );
    return input;
  };
  return walk(value);
}
export function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeError(error: unknown): { message: string } {
  return redact({
    message: error instanceof Error ? error.message : "Unknown error",
  });
}
