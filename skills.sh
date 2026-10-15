#!/usr/bin/env bash
# Download agent skills for a model, or for one employee's project folder.
#
#   ./skills.sh list claude                    # catalog + what is already installed
#   ./skills.sh list codex --json              # machine-readable (the office deck uses this)
#   ./skills.sh install claude pdf xlsx        # -> ~/.claude/skills/<name>
#   ./skills.sh install claude pdf --workspace ~/projects/hackathon
#                                              # -> <workspace>/.claude/skills/pdf
#   ./skills.sh remove claude pdf [--workspace DIR]
#   ./skills.sh doctor                         # dependencies and target folders
#
# Two scopes, because the office has two kinds of staff:
#   model scope    (no --workspace)  every terminal of that CLI gets the skill
#   employee scope (--workspace DIR) only that project's terminals get it
#
# Sources are the official skill repos: Anthropic's for Claude, OpenAI's curated and
# experimental lists for Codex. DeepSeek has no registry of its own, so it borrows the
# Anthropic catalog — a skill is a SKILL.md and some files, which travels fine.
set -euo pipefail

CLAUDE_REPO="anthropics/skills"
CLAUDE_PREFIX="skills"
CODEX_REPO="openai/skills"
CODEX_PREFIX="skills/.curated"
CODEX_ALT_PREFIX="skills/.experimental"
REF="${GHOSTGRID_SKILLS_REF:-main}"
CACHE_DIR="${GHOSTGRID_SKILLS_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/ghostgrid-skills}"
CACHE_TTL="${GHOSTGRID_SKILLS_TTL:-21600}" # 6h; the catalogs move slowly

die() { printf 'skills.sh: %s\n' "$1" >&2; exit "${2:-1}"; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }

# A skill name becomes a path, so it is checked before it is ever used as one.
valid_name() { [[ "$1" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ && "$1" != *..* ]]; }

runtime_repo() {
  case "$1" in
    claude|deepseek) printf '%s' "$CLAUDE_REPO" ;;
    codex)           printf '%s' "$CODEX_REPO" ;;
    *) die "unknown runtime '$1' (expected claude, codex or deepseek)" 2 ;;
  esac
}
runtime_prefix() {
  case "$1" in
    claude|deepseek) printf '%s' "$CLAUDE_PREFIX" ;;
    codex)           printf '%s' "$CODEX_PREFIX" ;;
  esac
}
# Where this runtime keeps its skills. With a workspace, the project's own folder.
runtime_home() {
  local runtime="$1" workspace="${2:-}"
  if [[ -n "$workspace" ]]; then
    printf '%s/.%s/skills' "${workspace%/}" "$runtime"
    return
  fi
  case "$runtime" in
    claude)   printf '%s/skills' "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ;;
    codex)    printf '%s/skills' "${CODEX_HOME:-$HOME/.codex}" ;;
    deepseek) printf '%s/skills' "${DEEPSEEK_HOME:-$HOME/.deepseek}" ;;
  esac
}

# ---- catalog ---------------------------------------------------------------------------------
# One call to the git tree API for every skill folder, then each SKILL.md's name/description in
# parallel. Cached, because a deck that redraws should not re-read GitHub every time.
catalog_json() {
  need python3
  local runtime="$1" repo prefix alt cache
  repo="$(runtime_repo "$runtime")"
  prefix="$(runtime_prefix "$runtime")"
  alt=""
  [[ "$runtime" == codex ]] && alt="$CODEX_ALT_PREFIX"
  cache="$CACHE_DIR/$runtime-$REF.json"
  mkdir -p "$CACHE_DIR"
  if [[ -f "$cache" ]]; then
    local age=$(( $(date +%s) - $(stat -c %Y "$cache" 2>/dev/null || echo 0) ))
    if (( age < CACHE_TTL )); then cat "$cache"; return; fi
  fi
  if ! REPO="$repo" PREFIX="$prefix" ALT_PREFIX="$alt" REF="$REF" python3 - > "$cache.tmp" <<'PY'
import json, os, sys, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

repo, prefix, alt, ref = os.environ["REPO"], os.environ["PREFIX"], os.environ["ALT_PREFIX"], os.environ["REF"]
token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
headers = {"Accept": "application/vnd.github+json", "User-Agent": "ghostgrid-skills"}
if token:
    headers["Authorization"] = f"Bearer {token}"

def get(url, raw=False):
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read()
    return body.decode("utf-8", "replace") if raw else json.loads(body)

try:
    tree = get(f"https://api.github.com/repos/{repo}/git/trees/{ref}?recursive=1")
except urllib.error.URLError as reason:
    print(f"could not reach github: {reason}", file=sys.stderr)
    raise SystemExit(1)

prefixes = [p for p in (prefix, alt) if p]
skills = {}
for node in tree.get("tree", []):
    path = node.get("path", "")
    if not path.endswith("/SKILL.md"):
        continue
    folder = path[: -len("/SKILL.md")]
    for base in prefixes:
        if folder.startswith(base + "/") and "/" not in folder[len(base) + 1:]:
            name = folder[len(base) + 1:]
            # A skill the repo marks as experimental says so on its card.
            skills[name] = {"name": name, "path": folder, "experimental": base == alt}

def describe(skill):
    """name/description out of the SKILL.md frontmatter; the card falls back to the folder name."""
    try:
        text = get(f"https://raw.githubusercontent.com/{repo}/{ref}/{skill['path']}/SKILL.md", raw=True)
    except Exception:
        return skill
    if not text.startswith("---"):
        return skill
    end = text.find("\n---", 3)
    lines = text[3: end if end > 0 else len(text)].splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        key, separator, value = line.partition(":")
        if not separator or key != key.lstrip():
            continue
        key, value = key.strip(), value.strip()
        if key not in ("description", "title"):
            continue
        # `description: >` or `: |` keeps the text on the following indented lines.
        if value in ("", ">", "|", ">-", "|-", ">+", "|+"):
            folded = []
            while index < len(lines) and (not lines[index].strip() or lines[index][:1] in (" ", "\t")):
                folded.append(lines[index].strip())
                index += 1
            value = " ".join(part for part in folded if part)
        else:
            value = value.strip("'\"")
        if value:
            skill[key] = value[:400 if key == "description" else 120]
    return skill

ordered = sorted(skills.values(), key=lambda s: (s["experimental"], s["name"]))
with ThreadPoolExecutor(max_workers=8) as pool:
    ordered = list(pool.map(describe, ordered))
json.dump({"repo": repo, "ref": ref, "items": ordered}, sys.stdout)
PY
  then
    rm -f "$cache.tmp"
    # A stale catalog beats no catalog when the network is down.
    [[ -f "$cache" ]] && { cat "$cache"; return; }
    die "could not fetch the $runtime skill catalog from $repo"
  fi
  mv "$cache.tmp" "$cache"
  cat "$cache"
}

installed_names() {
  local target="$1"
  [[ -d "$target" ]] || return 0
  local path name
  for path in "$target"/*/; do
    [[ -d "$path" ]] || continue
    name="$(basename "$path")"
    [[ "$name" == .* ]] && continue
    # A folder is a skill once it has a SKILL.md; anything else is someone's scratch directory.
    if [[ -f "$path/SKILL.md" ]]; then printf '%s\n' "$name"; fi
  done
  # Never report failure just because the last folder was not a skill: this runs inside `$(…)`
  # under `set -e`, where a 1 would take the whole script down.
  return 0
}

cmd_list() {
  local runtime="$1" workspace="${2:-}" as_json="${3:-}" target catalog
  target="$(runtime_home "$runtime" "$workspace")"
  catalog="$(catalog_json "$runtime")"
  local installed
  installed="$(installed_names "$target" | paste -sd, -)"
  local scope
  scope="$([[ -n "$workspace" ]] && echo employee || echo model)"
  if [[ "$as_json" == --json ]]; then
    CATALOG="$catalog" INSTALLED="$installed" RUNTIME="$runtime" TARGET="$target" \
      SCOPE="$scope" WORKSPACE="$workspace" python3 - <<'JSON_LIST'
import json, os, sys
catalog = json.loads(os.environ["CATALOG"])
installed = [name for name in os.environ["INSTALLED"].split(",") if name]
for item in catalog["items"]:
    item["installed"] = item["name"] in installed
# Skills present on disk but absent from the catalog still belong on the deck.
known = {item["name"] for item in catalog["items"]}
extra = [{"name": name, "path": "", "experimental": False, "installed": True, "local": True}
         for name in installed if name not in known]
json.dump({
    "runtime": os.environ["RUNTIME"], "scope": os.environ["SCOPE"],
    "workspace": os.environ["WORKSPACE"] or None, "target": os.environ["TARGET"],
    "repo": catalog["repo"], "ref": catalog["ref"], "items": catalog["items"] + extra,
}, sys.stdout)
JSON_LIST
    return
  fi
  printf 'skills for %s (%s scope) -> %s\n' "$runtime" "$scope" "$target"
  CATALOG="$catalog" INSTALLED="$installed" python3 - <<'TEXT_LIST'
import json, os
catalog = json.loads(os.environ["CATALOG"])
installed = {name for name in os.environ["INSTALLED"].split(",") if name}
for item in catalog["items"]:
    mark = "installed" if item["name"] in installed else ""
    tag = " (experimental)" if item["experimental"] else ""
    print("  %-34s%-10s%s%s" % (item["name"], mark, item.get("description", "")[:70], tag))
for name in sorted(installed - {item["name"] for item in catalog["items"]}):
    print("  %-34sinstalled  (local, not in catalog)" % name)
TEXT_LIST
}

cmd_installed() {
  local runtime="$1" workspace="${2:-}" as_json="${3:-}" target
  target="$(runtime_home "$runtime" "$workspace")"
  if [[ "$as_json" == --json ]]; then
    INSTALLED="$(installed_names "$target" | paste -sd, -)" TARGET="$target" python3 - <<'JSON_INSTALLED'
import json, os, sys
json.dump({"target": os.environ["TARGET"],
           "items": [name for name in os.environ["INSTALLED"].split(",") if name]}, sys.stdout)
JSON_INSTALLED
  else
    installed_names "$target"
  fi
}

# ---- install / remove ------------------------------------------------------------------------
cmd_install() {
  local runtime="$1" workspace="$2"; shift 2
  need curl; need tar; need python3
  local repo prefix alt target
  repo="$(runtime_repo "$runtime")"
  prefix="$(runtime_prefix "$runtime")"
  alt=""
  [[ "$runtime" == codex ]] && alt="$CODEX_ALT_PREFIX"
  target="$(runtime_home "$runtime" "$workspace")"
  if [[ -n "$workspace" ]]; then
    [[ -d "$workspace" ]] || die "workspace '$workspace' is not a directory" 2
  fi
  mkdir -p "$target"

  local tmp tarball
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  tarball="$tmp/repo.tar.gz"
  local auth=()
  [[ -n "${GITHUB_TOKEN:-${GH_TOKEN:-}}" ]] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN:-$GH_TOKEN}")
  curl -fsSL --max-time 120 "${auth[@]}" \
    "https://codeload.github.com/$repo/tar.gz/refs/heads/$REF" -o "$tarball" \
    || die "could not download $repo@$REF"
  # One archive serves every skill in this run.
  tar -xzf "$tarball" -C "$tmp"
  local root
  root="$(find "$tmp" -maxdepth 1 -type d -name '*-*' | head -1)"
  [[ -n "$root" ]] || die "unexpected archive layout from $repo"

  local skill source found=0
  for skill in "$@"; do
    valid_name "$skill" || die "invalid skill name '$skill'" 2
    source=""
    for base in "$prefix" $alt; do
      [[ -d "$root/$base/$skill" ]] && { source="$root/$base/$skill"; break; }
    done
    [[ -n "$source" ]] || { printf 'skills.sh: %s has no skill named %s\n' "$repo" "$skill" >&2; continue; }
    [[ -f "$source/SKILL.md" ]] || { printf 'skills.sh: %s is not a skill (no SKILL.md)\n' "$skill" >&2; continue; }
    rm -rf "$target/$skill"
    cp -R "$source" "$target/$skill"
    found=$((found + 1))
    printf 'installed %s -> %s/%s\n' "$skill" "$target" "$skill"
  done
  [[ "$found" -gt 0 ]] || die "nothing was installed"
}

cmd_remove() {
  local runtime="$1" workspace="$2" skill="$3" target
  valid_name "$skill" || die "invalid skill name '$skill'" 2
  target="$(runtime_home "$runtime" "$workspace")"
  [[ -d "$target/$skill" ]] || die "$skill is not installed in $target" 4
  # Only ever a directory this script would have written, and only one level deep.
  rm -rf "$target/$skill"
  printf 'removed %s from %s\n' "$skill" "$target"
}

cmd_doctor() {
  printf 'dependencies:\n'
  local tool
  for tool in curl tar python3; do
    printf '  %-8s %s\n' "$tool" "$(command -v "$tool" || echo MISSING)"
  done
  printf 'targets:\n'
  local runtime target
  for runtime in claude codex deepseek; do
    target="$(runtime_home "$runtime")"
    printf '  %-9s %-40s %s\n' "$runtime" "$target" "$([[ -d "$target" ]] && echo "$(installed_names "$target" | wc -l) installed" || echo "not created yet")"
  done
  printf 'cache: %s (ttl %ss)\n' "$CACHE_DIR" "$CACHE_TTL"
}

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local command="${1:-}"
  [[ -z "$command" || "$command" == -h || "$command" == --help ]] && { usage; exit 0; }
  shift
  local runtime="" workspace="" as_json="" skills=()
  while (($#)); do
    case "$1" in
      --workspace) workspace="${2:-}"; [[ -n "$workspace" ]] || die "--workspace needs a directory" 2; shift 2 ;;
      --json)      as_json=--json; shift ;;
      --ref)       REF="${2:-}"; shift 2 ;;
      -*)          die "unknown option '$1'" 2 ;;
      *)           if [[ -z "$runtime" ]]; then runtime="$1"; else skills+=("$1"); fi; shift ;;
    esac
  done
  # A leading ~ in a workspace from a config file is not expanded by the shell.
  [[ "$workspace" == "~"* ]] && workspace="$HOME${workspace:1}"
  case "$command" in
    list)      [[ -n "$runtime" ]] || die "list needs a runtime" 2; cmd_list "$runtime" "$workspace" "$as_json" ;;
    installed) [[ -n "$runtime" ]] || die "installed needs a runtime" 2; cmd_installed "$runtime" "$workspace" "$as_json" ;;
    install)   [[ -n "$runtime" && ${#skills[@]} -gt 0 ]] || die "install needs a runtime and at least one skill" 2
               runtime_repo "$runtime" >/dev/null; cmd_install "$runtime" "$workspace" "${skills[@]}" ;;
    remove)    [[ -n "$runtime" && ${#skills[@]} -eq 1 ]] || die "remove needs a runtime and one skill" 2
               runtime_repo "$runtime" >/dev/null; cmd_remove "$runtime" "$workspace" "${skills[0]}" ;;
    doctor)    cmd_doctor ;;
    *)         die "unknown command '$command' (try list, installed, install, remove, doctor)" 2 ;;
  esac
}

main "$@"
