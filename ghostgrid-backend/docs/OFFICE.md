# The office: roles, briefs and orchestration

An office is one building's org chart, and it is the thing that turns a provider into staff. The
same Claude or Codex provider behaves like a manager or an engineer because of what this layer
puts in front of every prompt.

Four pieces, in the order they matter:

| Piece | File | What it owns |
| --- | --- | --- |
| Roles | `src/office/roles.ts` | What a job *is*: its remit, how it must answer, where it sits in a run, and its seniority |
| Briefs | `src/office/brief.ts` | One employee's standing context, composed from their role plus their own org fields |
| Employees | `src/sessions/service.ts` | A session with a role, a team, a manager and a work stream — the unit the engine runs as |
| Orchestration | `src/office/orchestrator.ts` | The org chart laid out as a dependency graph and handed to the execution engine |

## Roles

A role is `{ id, name, kind, rank, remit[], answer[] }`, stored per project on the project record
as `officeRoles`. A project that has never edited its roles reads back three defaults — Manager,
Team Lead, Engineer — so nothing needs migrating.

- **`name`** is the job title. It is what a session stores in `title`, and renaming a role moves
  its holders onto the new title and rebuilds their briefs.
- **`kind`** is `manage`, `lead` or `build`, and it decides where a holder lands in a run. This is
  what lets a job the operator invented take part: "Staff Engineer" with kind `lead` is handed the
  plan and reviews its engineers, whatever it is called. Nothing in the graph compares job titles.
- **`rank`** orders the ladder, so promote and demote have somewhere to step. Equal ranks are a
  flat org, where promotion simply has no target.
- **`remit`** and **`answer`** are the prompt. They become the brief's "Your remit as X" and
  "How to answer" sections verbatim.

```http
GET    /api/v1/office/roles?projectId=<uuid>          # roles + holder counts + kinds + presets
POST   /api/v1/office/roles                           # {projectId,name,kind,rank,remit[],answer[]}
PATCH  /api/v1/office/roles/<role slug>               # answers with {renamedFrom, rebriefed}
DELETE /api/v1/office/roles/<role slug>?projectId=&reassignTo=
```

`PATCH` and `DELETE` move every holder through `SessionService`, so a brief can never point at a
role that no longer says what it used to. `rebriefed` is how many employees were rewritten; an
employee with no title at all counts, because they resolve to the most junior role everywhere
else in the office.

`GET` also returns `presets` — Reviewer, QA Engineer, Architect, Technical Writer — so a new role
starts from a real job description rather than an empty form.

## Briefs

`composeBrief` is deterministic: same role and same org fields in, same text out. Callers never
write a brief; they set fields and it is rebuilt. It states, in this order: who the employee is,
their chain of command, their project and goal, their role's remit, their workspace and
permissions, how they must answer, and any standing note the operator wrote for them alone
(`briefNotes`).

The execution engine prepends the stored brief to every prompt that session runs
(`src/execution/engine.ts`), which is why a promotion changes behaviour rather than a label: the
next task is briefed as the new job.

## Employees

An employee is a session with org fields: `title`, `team`, `managerId`, `officeProjectId`,
`briefNotes`. Writes go through `PATCH /api/v1/sessions/<id>`, which validates the title against
the project's roles, refuses a reporting loop or a manager in another building, and recomposes the
brief on every change.

```http
POST /api/v1/office/employees/<session uuid>/promote   # one rung up the rank ladder
POST /api/v1/office/employees/<session uuid>/demote    # one rung down
```

Both answer `{employee, from, to, direction}` and 409 at the ends of the ladder, naming what the
operator would have to add to go further. Reports are left where they are: a demoted manager keeps
their reports until someone moves them, which is visible in the chart rather than guessed at.

Desks that are external terminal windows (`officeWorker`) are not employees. A human is typing in
that window; the server cannot send it work, so it has no role, no brief and no place in a run.

## Orchestration

`POST /api/v1/office/orchestrate` reads the chart out of the employees assigned to one work stream
and submits it as a workflow:

```
manage (plan) ──┬── lead A (design) ──┬── build (engineer) ──┬── lead A (review) ──┐
                │                     └── build (engineer) ──┘                     ├── manage (sign-off)
                └── lead B (design) ────── build (engineer) ───── lead B (review) ──┘
```

Two engine behaviours carry the hand-off: each node runs as that employee's own session, so their
brief applies, and a task is given the output of everything it depends on, so the plan reaches the
leads and the leads' designs reach their engineers as real text. Missing layers degrade with a
warning rather than an error — no planner means each lead plans their own slice; no implementer
means the run produces plans and approaches and says so.

`POST /api/v1/office/orchestrate/plan` returns the same graph without submitting anything, so the
office can show the operator what a run would cost before it runs.

## Where this is in the UI

The office page (`ghostgrid-frontend/frontend/src/city/office/OfficePage.tsx`) is one screen with
a tabbed rail: **Roster** (who is here, and hiring a CLI), **Board** (work-stream staffing),
**Org** (`OrgEditor.tsx`: reporting lines, promote/demote, standing notes, and the composed brief
read-only), **Roles** (`RolesDeck.tsx`: the editor for everything above), **Runs**
(`Orchestrator.tsx`: plan, run, watch), and **Skills**.

## Tests

`tests/office-roles.test.ts` covers the role surface end to end over real HTTP: defaults and
holder counts, a custom role reaching a holder's brief, an unknown title refused, an edit and a
rename reaching every holder, deletion moving staff, the promote/demote ladder including its ends,
and a graph built from kinds rather than titles. `tests/orchestrator.test.ts` covers the graph
itself.
