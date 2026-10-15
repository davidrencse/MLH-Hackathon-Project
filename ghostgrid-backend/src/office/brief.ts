// Role briefs: the standing context an office employee carries into every task.
//
// A brief is composed here, on the server, from the employee's structured org fields (title,
// team, manager, project, workspace) and stored on the session. The execution engine prepends
// it to every prompt that session runs, so an engineer and a manager on the same provider
// behave differently without the caller having to prompt them differently each time.
//
// What a job *is* comes from the project's role definitions (roles.ts), which the operator can
// edit and extend. This file turns one of those definitions plus one employee's org fields into
// text. Composition stays deterministic: same role and same fields in, same text out.
//
// Callers never write the brief directly — they set the fields and the brief is rebuilt — so it
// can never drift from the org chart. Free-text from the operator goes in `notes` and is kept in
// its own section, below the role's own remit.
import type { OfficeRole } from "./roles.js";

/** A job title, as the operator named it. Validated against the project's roles, not an enum. */
export type OfficeTitle = string;

export interface BriefInput {
  employeeName: string;
  /** The employee's job, as the project defines it. Supplies the remit and the answer shape. */
  role: BriefRole;
  team: string;
  /** Building label, e.g. "Claude Nexus" — what the employee calls their workplace. */
  buildingName: string;
  /** Provider type backing the building, e.g. "claude". Tells the agent what it is running on. */
  providerType?: string;
  manager?: { name: string; title: OfficeTitle };
  reports?: { name: string; title: OfficeTitle }[];
  project?: { name: string; goal?: string };
  workspace?: string;
  permissions?: ("read" | "write")[];
  notes?: string;
}

/** The role this brief speaks for. `OfficeRole` from roles.ts satisfies it. */
export type BriefRole = Pick<OfficeRole, "name" | "remit" | "answer">;

const bullets = (lines: string[]) => lines.map((line) => `- ${line}`).join("\n");

// "an Engineer", "a Manager". The brief is read by a model, but a job title the operator typed
// deserves a sentence that scans.
const article = (word: string) => (/^[aeiou]/i.test(word.trim()) ? "an" : "a");

/** Compose the standing brief for one employee. Deterministic; safe to call on every write. */
export function composeBrief(input: BriefInput): string {
  const title = input.role.name;
  const { remit, answer } = input.role;
  const workplace = input.providerType
    ? `${input.buildingName} (running on the ${input.providerType} provider)`
    : input.buildingName;

  const chain = [
    input.manager
      ? `Reports to: ${input.manager.name}, ${input.manager.title}.`
      : "Reports to: the operator, who runs this organisation. There is no manager above you.",
    input.reports?.length
      ? `Direct reports: ${input.reports.map((r) => `${r.name} (${r.title})`).join(", ")}.`
      : "Direct reports: none.",
    `Escalate anything outside your remit to ${input.manager ? input.manager.name : "the operator"} instead of deciding it alone.`,
  ];

  const project = input.project
    ? [
        `Project: ${input.project.name}`,
        input.project.goal ? `Goal: ${input.project.goal}` : "Goal: not stated yet — ask before making assumptions about scope.",
        "Judge your work by whether it moves this goal. If a task you are given conflicts with the goal, say so before acting on it.",
      ]
    : [
        "You are on the bench: no project is assigned to you yet.",
        "Do not start work speculatively. Ask what the priority is.",
      ];

  const workspace = input.workspace
    ? [
        `Repository: ${input.workspace}`,
        input.permissions?.includes("write")
          ? "You may modify files in that repository."
          : "You have read access only. Propose changes as diffs or instructions; do not claim to have applied them.",
        // Without this line an employee burns its whole turn discovering the sandbox by trial
        // and error: a recursive search at the repository root is refused, because the native
        // tool would read .git and any secrets alongside it before anything could filter them.
        // Observed in a real run — an engineer tried five glob patterns, had each one denied,
        // and reported the task as unverifiable.
        "Searching: a recursive search (Glob/Grep) at the repository root is refused, because it would take in .git and any secrets beside it. Search inside a subdirectory, or read a named file directly — both are allowed.",
      ]
    : [
        "No workspace is attached to you. You cannot read or write project files.",
        "Work from what the task gives you, and say when you need file access rather than inventing file contents.",
      ];

  return [
    `# Role brief — ${input.employeeName}, ${title}, ${input.team} team`,
    `You are ${input.employeeName}, ${article(title)} ${title} on the ${input.team} team at ${workplace}.`,
    "This is standing context about your role, not a task. Your actual work arrives separately as tasks. Stay in this role across every task you are given.",
    `## Chain of command\n${chain.join("\n")}`,
    `## Project\n${project.join("\n")}`,
    `## Your remit as ${title}\n${bullets(remit)}`,
    `## Workspace\n${workspace.join("\n")}`,
    `## How to answer\n${bullets(answer)}`,
    input.notes?.trim() ? `## Notes from the operator\n${input.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
