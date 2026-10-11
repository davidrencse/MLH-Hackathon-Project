/** Keep supported local authentication locations but avoid passing unrelated API credentials to agents. */
export function codingEnvironment(
  allowedSecrets: string[],
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const allowed = new Set([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "TERM",
    "COLORTERM",
    "NO_COLOR",
    "FORCE_COLOR",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    ...allowedSecrets,
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined && (allowed.has(name) || name.startsWith("LC_")),
    ),
  ) as Record<string, string>;
}
