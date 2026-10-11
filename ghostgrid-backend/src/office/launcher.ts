import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { validateWorkspace } from "../security/index.js";

export type OfficeRuntime = "codex" | "claude" | "chatgpt-browser" | "claude-browser";
export interface LaunchPlan { executable: string; args: string[]; cwd?: string }
export interface OfficeLauncher {
  available(): { runtimes: OfficeRuntime[]; terminal: string | null };
  launch(runtime: OfficeRuntime, workspace?: string): Promise<{ pid?: number }>;
}
const unavailable = (message: string): never => {
  throw Object.assign(new Error(message), { statusCode: 409 });
};

export function findExecutable(name: string): string | null {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const path = join(directory, name);
    try { accessSync(path, constants.X_OK); return path; } catch { /* next PATH entry */ }
  }
  return null;
}

// Fixed argv, no shell: neither a worker name nor a workspace can become a command.
export function planLaunch(
  runtime: OfficeRuntime,
  workspace: string | undefined,
  allowedWorkspaces: string[],
  find: (name: string) => string | null = findExecutable,
): LaunchPlan {
  if (runtime === "chatgpt-browser" || runtime === "claude-browser") {
    const url = runtime === "chatgpt-browser" ? "https://chatgpt.com/" : "https://claude.ai/new";
    for (const name of ["google-chrome", "chromium", "chromium-browser", "firefox"]) {
      const executable = find(name);
      if (executable) return { executable, args: ["--new-window", url] };
    }
    const opener = find("xdg-open");
    if (opener) return { executable: opener, args: [url] };
    return unavailable("Install a browser or xdg-open on the Ghostgrid machine.");
  }
  if (!workspace) return unavailable("Choose a workspace before opening a coding terminal.");
  const cwd = validateWorkspace(workspace, allowedWorkspaces);
  if (!statSync(cwd).isDirectory()) return unavailable("Choose a project folder, not a file.");
  const cli = find(runtime);
  if (!cli) return unavailable(`Install and sign in to the ${runtime} CLI on the Ghostgrid machine.`);
  for (const name of ["kitty", "konsole", "gnome-terminal", "xterm"]) {
    const executable = find(name);
    if (!executable) continue;
    const args = name === "kitty" ? ["--directory", cwd, cli]
      : name === "konsole" ? ["--separate", "--workdir", cwd, "-e", cli]
      : name === "gnome-terminal" ? [`--working-directory=${cwd}`, "--", cli]
      : ["-e", cli];
    return { executable, args, cwd };
  }
  return unavailable("Install Kitty, Konsole, GNOME Terminal or xterm to open coding workers.");
}

export function createOfficeLauncher(allowedWorkspaces: string[]): OfficeLauncher {
  return {
    available() {
      const terminal = ["kitty", "konsole", "gnome-terminal", "xterm"].find((name) => findExecutable(name)) ?? null;
      const desktop = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
      const browser = ["google-chrome", "chromium", "chromium-browser", "firefox", "xdg-open"].some((name) => findExecutable(name));
      return { terminal, runtimes: desktop ? [
        ...(terminal && findExecutable("codex") ? ["codex" as const] : []),
        ...(terminal && findExecutable("claude") ? ["claude" as const] : []),
        ...(browser ? ["chatgpt-browser" as const, "claude-browser" as const] : []),
      ] : [] };
    },
    async launch(runtime, workspace) {
      if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
        return unavailable("The Ghostgrid machine needs a desktop session to open windows.");
      const plan = planLaunch(runtime, workspace, allowedWorkspaces);
      return new Promise((resolve, reject) => {
        const child = spawn(plan.executable, plan.args, { cwd: plan.cwd, detached: true, stdio: "ignore", shell: false });
        let settled = false;
        const timer = setTimeout(() => {
          settled = true;
          child.unref();
          resolve({ pid: child.pid });
        }, 350);
        child.once("error", () => {
          clearTimeout(timer);
          if (!settled) reject(Object.assign(new Error("Could not open the application. Check the desktop session and CLI installation."), { statusCode: 409 }));
        });
        child.once("exit", (code) => {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          if (code && code !== 0) reject(Object.assign(new Error("The application exited before opening. Check its installation and desktop session."), { statusCode: 409 }));
          else resolve({ pid: child.pid });
        });
      });
    },
  };
}
