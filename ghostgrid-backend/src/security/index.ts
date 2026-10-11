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
export function registerSecret(value: string | undefined): void {
  if (value) registeredSecrets.add(value);
}
export function redact<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  const secrets = [
    ...registeredSecrets,
    ...Object.entries(env)
      .filter(
        ([key, value]) =>
          /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) &&
          value &&
          value.length >= 4,
      )
      .map(([, value]) => value!),
  ].sort((a, b) => b.length - a.length);
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
