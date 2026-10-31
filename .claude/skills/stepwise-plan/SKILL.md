---
name: stepwise-plan
description: Plan-then-implement workflow for non-trivial tasks (upgrades, migrations, multi-file features, refactors), from a ticket or from the developer's prompt. Writes a living markdown plan in the closest `docs/plans/active/<TICKET> <title>.md`, pressure-tests it (professional approach, side problems, contradictions with the repo's markdown docs and with the goal) until it is clean, then implements it ONE small, testable step at a time — verify, record what was done in the plan, stop for the developer's check, continue — and on completion updates Roadmap / Backlog / Decisions and moves the plan to `docs/plans/archived/`. Use when the developer says "make a plan", "let's do this step by step", "plan and implement", "start the ticket", gives a ticket to work on, or when a task clearly spans many steps/files. Not for one-file fixes.
---

Source: worked out on DDE-20289 (React 19 / Next 16 upgrade); any plan under `docs/plans/archived/` is a real example of the format.

# Stepwise plan — plan in markdown, implement in small verified steps

The developer reviews and tests **every step** before the next one starts. The plan file is the single source of truth: what will be done, what was done, what was found, what is out of scope. **The ticket never holds the steps** — it holds the goal, the ACs and the Dev ACs (`create-trello-ticket` skill); its `Dev` checklist only points at this plan.

## The `docs` folders — where everything lands

All written work goes into a `docs` folder: at the repo root, or — in a monorepo — under a package, a service or a feature (`packages/<pkg>/docs/`, `…/services/<service>/docs/`, `…/features/<feature>/docs/`). **Rule: update the closest and most logical `docs` folder** for the thing being implemented. A plan that spans several packages goes to the root `docs/`.

Inside it:

- `docs/plans/active/` — new, ongoing and planned-ahead plans.
- `docs/plans/archived/` — completed or rejected plans (with a status line saying which, and why).
- `Roadmap.md`, `Backlog.md`, `Decisions.md` — updated when a plan completes (Phase 3). They may sit in a subfolder (this repo: `docs/Roadmap.md`, `docs/implementation/Backlog.md`, `docs/architecture/Decisions.md`); find them by name: `find docs -name Roadmap.md -o -name Backlog.md -o -name Decisions.md`. A file that does not exist is skipped, never created by this skill.

## Phase 0 — Gather the input

The plan comes **from a ticket** or **from the developer's prompt**. Most of the time it is written **when the ticket starts**, so it is precise against the codebase as it is then. A plan the developer asks for ahead of time is written the same way and marked `Status: planned ahead on <date> — re-verify the Targets table before Step 0.1`.

1. **Ticket.** The developer gives the ticket number (`<PREFIX>-<number>`, e.g. `DDE-20324`, `DAIG-20330`). Not given → find it: the branch name (`git branch --show-current`, usually `<PREFIX>-<number>-<title>`), the ticket named in the conversation or in an analysis file, `trelloSearch` by the title the developer used. Still unknown → ask for the number (one question). Then read the card (`trelloSearch` / `trelloReadCard` / `trelloReadChecklist`): story, links, checklists — these define the goal and the acceptance criteria. **No ticket at all** (prompt only) → ask for a short title and plan without a number.
   **A ticket whose ACs are not known yet.** Some tickets state the problem clearly but nobody knows the solution yet, so
   nobody can write what "done" looks like. Such a ticket (the `create-trello-ticket` skill says how it is written: the
   problem and the suggested approaches in the description, one AC `Analysis needed: the ACs are written from it`, no Dev
   ACs) is still **one ticket with one plan**. The analysis is part of the plan, because the plan needs it before it can
   name steps:
   - The plan's first phase after the baseline is `## Phase 1 — Analysis`: the problem as found in the code, each suggested
     approach with its trade-offs and, where possible, a measurement, the recommendation. It is written into the plan file
     as a `## Analysis` chapter and reviewed by the developer like any step.
   - The developer decides the approach. From that outcome the ACs and Dev ACs are written **on the ticket's card**
     (`ACs - Given When Then` and `Dev ACs` checklists; approved in chat first, as the `create-trello-ticket` skill's Step 0
     does for a new ticket), and the `Analysis needed` item is ticked.
   - Only now are the implementation phases planned (Phase 2 onwards), pressure-tested and executed as in every plan.
   - In Phase 3 the whole plan file, the `## Analysis` chapter included, is posted on the card as comments, so the card
     ends up holding the problem, the analysis, the ACs and the result.
2. **Existing plan — check before writing.** Search every `docs/plans` folder of the repo for the ticket or topic:
   ```sh
   find . -path '*/docs/plans/*' -name '*<TICKET or keyword>*' -not -path '*/node_modules/*'
   ```
   - In **`active`** → that plan is the one to continue; read it and resume at its first `[ ]` step. Never write a second plan for the same ticket.
   - In **`archived`** → the topic was **completed or rejected**. Stop and clarify with the developer before anything else: show the file and its status line; the developer may have named the wrong ticket, or wants a follow-up (a new ticket and a new plan that names the archived one under `Based on`), or wants to reopen (move the file back to `active`, add a `Reopened <date>: <why>` line, continue).
   - Not found → a new plan.
3. **Existing research.** Read any doc/report the ticket links to (e.g. a readiness/audit report in `docs/`). Do not redo research that already exists — **verify** it instead (versions on npm, files in the repo, usage counts).
4. **Reality check the repo** before planning: actual installed versions (`pnpm ls`), actual usages (`grep`), configs, scripts. Report discrepancies between the research and the code as findings in the plan.

## Phase 1 — Write the plan

**Where:** `<closest docs>/plans/active/<TICKET> <title>.md` — e.g. `docs/plans/active/DDE-20289 Bump React 19 and nextJs 16.md`, or `packages/server-app/docs/plans/active/DDE-20330 Invoice export.md`. Create `plans/active/` (and `plans/archived/`) if missing. No ticket → `…/plans/active/<title>.md`.

**The ticket points here.** When the card exists (created by `create-trello-ticket`, or earlier), its `Dev` checklist carries the single item ``Plan has been prepared in the codebase: `<path>` `` and `### Background & Context` ends with `Plan: <path>`; set or correct both once the file exists (the developer may prefer to do this himself — ask once per ticket). The card gets no step list, ever.

**Interview first when the design is open.** When the input leaves design branches open (two valid shapes, an unclear
boundary, a term used two ways), offer the developer the `grilling` skill before writing the plan: one question at a time
until the branches are closed. The answers land in `## Targets / decisions`; a term settled on the way lands in the glossary
at once (`CLAUDE.md`, Terminology). Skip the offer when the input already fixes the design.

**Structure (keep this order):**

```markdown
# <Title>

Ticket: [<TICKET> <title>](<trello url>)
Branch: `<branch>`
Feature tag: `<Feature>` (the `(feat: …)` of the step commits)
Based on: <research doc / report / archived plan>, verified on <date>
Status: active since <date>

## How we work with this document
- One step at a time. Claude implements + verifies, <Dev> reviews/tests, then the next step.
- Other plans may run in parallel in other sessions, in the same working tree: their files are not this plan's, and this plan's commit messages go to `temp/commit - <Feature>.md`, never to a shared file.
- Every step is a self-contained commit that keeps the project building and running.
- Status marks, at the **front** of every step heading (`### [ ] Step X.Y — …`) so the plan reads as a checklist: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped (with reason).
- Findings that change the plan are written into the step's **Notes**.

## Continue from the CLI
Run from the repo root (`<absolute path of the repo>`).
- **Resume the conversation that wrote this plan** (its context, its findings, the discussion behind the decisions):
  ```sh
  claude --resume <session id>
  ```
- **Fresh session** (after a `/clear`, on another day, or when the one above is gone):
  ```sh
  claude "Continue the plan '<path>/plans/active/<TICKET> <title>.md': read it, then start at the first [ ] step through the implement-task skill."
  ```
- A session that picks the plan up adds its own id under the first line, so the thread of every step can be reopened.

## Targets / decisions (verified <date>)
| Package / item | Now | Target | Why this and not something else |
...
**Kept as-is:** ...   **Out of scope → follow-ups** (see the end)

## Interfaces (final state)
Every interface, type and enum the plan adds or changes, as it will read when the plan is done, JSDoc included
(`jsdoc-style` skill). One ```ts block per file; the block opens with a comment that names the file's full repo path and
whether the symbol is `NEW` or `CHANGED`. In a `CHANGED` symbol every added or changed member carries a trailing
`// NEW` / `// CHANGED: <what>` / `// REMOVED` comment; unchanged members are listed without a comment, so the diff is
visible. The developer approves this chapter before Step 0.1 starts.

```ts
// packages/<pkg>/src/internal/<folder>/types.ts — CHANGED
export interface IFooConfig {
  enabled: boolean;
  /** … */
  strategy?: TFooStrategy; // NEW
  maxTurns?: number;       // REMOVED
}
```

## Phase 0 — Baseline
### [ ] Step 0.1 — Baseline
- **Files:** none
- **Do:** full build, lint, tests. Record pass/fail counts, warnings, pre-existing failures HERE.
- **Rule from here:** no NEW failures; pre-existing ones are tracked, not fixed, in this ticket.

## Phase 1 — <low-risk prep>
### [ ] Step 1.1 — <name>
- **Files:** exact files that will be touched
- **Do:** what changes, in 1–3 lines
- **Verify (Claude):** the commands/checks that prove it (build, tsc, lint, tests, a rendered output, a curl…)
- **Check (<Dev>):** what only the developer can/should verify (visual, runtime, prod-like)
- **Notes:** open questions, risks, decisions needed from the developer

## Phase 2 — <the risky core>
...
## Phase N — Finalize (docs, Roadmap / Backlog / Decisions, CLAUDE.md, ticket checklists, archive the plan)

## Follow-up tickets (not in this ticket)
| Topic | Why separate | Ticket |

## Pressure test
Passed <date> after <n> round(s). One line per issue found: what it was → how the plan was changed (or what the developer decided).
```

**Rules for good steps**
- Small: one dependency group, one component, one config — testable in minutes, reviewable as one diff.
- Ordered by risk: React-18-safe prep first, the switch last; each step leaves the repo green.
- Each step names its **files**. If you can't name them, the step is too big — split it.
- Anything speculative or out of scope goes to the **Follow-up tickets** table, not into a step — and is decided there before Step 0.1 (see Phase 1's last paragraph).
- The last phase is always **Finalize** and includes the Phase 3 work below as steps, so it is reviewed like any other step.
- **"Continue from the CLI" is filled, never left as a template.** The session id is the name of the current session's
  `.jsonl` under `~/.claude/projects/<project folder>/` — the same UUID as the last folder of this session's scratchpad
  path; check it with `ls -t ~/.claude/projects/<project folder>/*.jsonl | head -1`. The plan is the state across sessions
  (see the end of this file); this section is how the developer gets back into it without searching the history.
- Ask the developer only for decisions that change the work (e.g. "remove dead deps or bump them?") — put the default in the plan and continue.

**Follow-ups are settled before the code.** The `## Follow-up tickets` table is not a parking lot: before Step 0.1 the
developer goes through every row and decides, per row, **in this ticket** (it becomes a step) or **a ticket of its own**
(created now with the `create-trello-ticket` skill, its URL written into the row; when the problem is clear and the
solution is not, written as a ticket whose ACs come from its analysis, see Phase 0) or **dropped** (the row is removed). No
implementation starts while a row has no decision; a follow-up found during implementation is added to the table and
decided the same way at the next handoff. The developer must know precisely what is left out and where it lives.

### Pressure test — before the plan is presented

A written plan is a draft until it survives a pressure test. Read it as a hostile senior reviewer would, not as its
author: the goal is to find what breaks, not to confirm it works. Check it on three axes:

1. **Professional approach.** Is every step the standard, mature way to do it today, or a shortcut, a workaround, an
   invented pattern, an over-abstraction? Would a senior engineer approve it in review? Does it follow `CLAUDE.md`'s
   coding and architecture rules?
2. **Side problems.** What else does the change touch that the plan does not name: other callers, the public API, tests,
   types, performance, security, data or migrations, docs that go stale, the other plans running in parallel in this
   tree? Does every step really leave the repo green?
3. **Contradictions.** Does the plan contradict the logic of the repo's markdown files: `CLAUDE.md`, the Roadmap (its
   working rules), the decisions (`D…`), the class and architecture docs, the Backlog, the user docs, the other active
   plans? And does it fix what the ticket asks: does every AC map to a step, and does any step work against the goal?
4. **Concept boundaries.** Invent concrete edge-case scenarios that probe where one concept ends and the next begins
   (the thread with no turns, the tool call that outlives its step, the entity shared by two tenants) and check the plan
   answers each one. Every term the plan uses matches the glossary (`CLAUDE.md`, Terminology); a term used two ways is an
   issue.

**The loop:**

- **Run** the three checks over the whole plan and list every issue.
- **Fix** each issue in the plan. An issue that only the developer can settle (an unclear requirement, a choice between
  two valid designs) → ask him (`AskUserQuestion`, the recommended option first) and write his answer into the plan.
  Asking is not a failed round.
- **Re-run** the full test on the changed plan, since a fix can create a new issue. Repeat until a round finds **zero
  issues**.
- **Stop after 3 unsuccessful rounds.** If issues are still there after the third round of fixes, stop fixing and hand
  them to the developer. Per problem: what is wrong, in plain language and with a concrete example (no jargon, no
  internal ids without their meaning), why it matters, and 1–3 possible solutions with the recommended one first. He
  decides; apply his decisions and run the test once more.
- **Record** the result in the plan's `## Pressure test` chapter: the date, the number of rounds, one line per issue and
  how it was resolved.

A change the developer makes to the plan during his review is pressure-tested again (the loop above) before Step 0.1.

Present the plan, then **stop**: the developer reviews/adjusts it — the `## Interfaces (final state)` chapter, then the
follow-ups — before step 0.1 starts. A plan is presented only after its pressure test passed, or with the open problems
listed for the developer's decision.

## Phase 2 — Execute, one step at a time

Each step runs through the `implement-task` skill — it owns the implement → verify → docs → `temp/commit - <Feature>.md` →
"Ready for review" → review round-trips → commit cycle. This skill only says what the plan file needs from each pass:

1. Mark the step `[~]` (the mark at the front of its heading) before touching code; the step's **Files / Do / Verify**
   lines are the unit's scope.
2. **Record in the plan** before handing off (this is what makes the doc valuable later):
   - Heading mark → `[x]`, plus a **`Done <date>:`** line: what was actually changed (versions, files, the one-line why for each non-obvious change).
   - **Findings:** pre-existing issues discovered (broken tests, dead deps, stale configs) — fixed only if they block the step; otherwise noted + added to follow-ups.
   - **Deviations:** if the step had to grow or a later step was pulled forward, add it as `### [ ] Step X.Yb — … (pulled forward from N)` — don't silently widen a step.
   - Things that could NOT be verified and why (no browser, needs a key, needs prod) → that becomes the developer's check.
3. Subject line of the step's commit message: `<TICKET> (feat: <Feature>) dev: Step X.Y — <short summary>` — `<Feature>` is the plan's short name, fixed in the plan's header (`Feature tag:`), so the steps of one plan are found together in the log of a ticket that carries several plans.
4. **Ring the bell at every handoff.** The developer runs several sessions and does not watch this one; the moment a step
   is complete and "Ready for review" is about to be sent, play the completion sound from the Bash tool, detached so the
   call returns at once (macOS; the same sound the thread-bell Stop hook uses):
   ```sh
   ( afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1 & )
   ```
   Every review round-trip that ends in "Ready for review" rings again; a reply that only answers a question does not.
5. The developer's "commit" closes the step; "commit and proceed" / "CAP" closes it and starts the first `[ ]` step.
   Any other OK ("proceed", "next") without "commit" starts the next step with the previous one still uncommitted —
   say so in the handoff. If they ask for a visual check later, **remind them** at the agreed moment.

**When something breaks mid-step**
- Root-cause it before changing anything else (e.g. duplicate emotion instances were a stale Vite dep cache, not a dependency bug).
- If the fix belongs to a later step, pull that step forward (`Step X.Yb`) and say so.
- Temporary helper files for a check (e.g. a `*.TEMP.stories.tsx`) must be listed in the plan with "**delete before commit**" and removed when the check is done.

## Phase 3 — Finish (the Finalize steps of the plan)

When every step is `[x]` or `[-]` (with reasons) and the follow-ups table is complete:

1. **Update the docs of the closest `docs` folder** (the one that holds the plan; the root `docs/` too when the change is repo-wide). Each file only if it exists; add the ticket number and link wherever a line refers to this work:
   - **`Roadmap.md`** — tick the checkboxes of what this plan completed (or move the item from the planned to the done section when the file has no checkboxes), with a brief line of what shipped and the ticket.
   - **`Backlog.md`** — mark the entries this plan solved `[x]` with the plan step or commit (the file's Lifecycle), add the issues found and not fixed as new entries (`#### Found in` names the plan), and one brief line per closed entry of what was done.
   - **`Decisions.md`** — the critical logical decisions this change introduced or amended (what, why, consequence), derived from `docs/internal` when the repo keeps the truth there (this repo: `write-user-docs` skill, decision ids `D…`). A decision earns an entry here only when all three hold: **hard to reverse** (changing it later costs real work), **surprising without context** (a reader of the code would ask "why this way?"), **a real trade-off** (there were genuine alternatives). A decision that fails one test stays in the plan and in the internal docs only.
   - **The glossary** (`CLAUDE.md`, Terminology) — verify every term this plan introduced or sharpened has its row; the rows were meant to be written as the terms were resolved, this is the check, not the moment to write them.
2. **Update `CLAUDE.md` and the other docs** the change made stale (tech-stack versions, commands, rules).
3. **Confirm, then post the plan on the ticket.** Ask the developer once whether the ticket is really completed (every step
   `[x]` or `[-]` is necessary, not sufficient — he may know of a check still open). On yes, and only when the plan has a
   ticket, post the **full content of the plan file** as a new comment on the Trello card (`trelloWriteCard` `add_comment`;
   Trello caps a comment at 16 384 characters — a longer plan goes in consecutive comments, "part 1/n" first). The file is
   archived and later leaves the repo; the comment lives as long as the ticket, so a human or an agent who opens the ticket
   in a year reads what was planned, what was done, what was found and what was left out; a plan with an `## Analysis`
   chapter (Phase 0, a ticket whose ACs came from the analysis) posts it too, so the card holds the analysis. A plan without
   a ticket skips this.
4. **Archive the plan.** Add `Status: completed <date>` (or `Status: rejected <date> — <why>`, for a plan that is dropped) under the title, then move the file unchanged in name:
   ```sh
   mv "<docs>/plans/active/<TICKET> <title>.md" "<docs>/plans/archived/<TICKET> <title>.md"
   ```
   Fix the `Plan:` path on the ticket and in any doc that links the file. A plan the developer rejects before or during implementation is archived the same way, with the reason.
5. **Ticket.** Tick the ticket's checklists (Trello) if the developer asks; the `Dev` item is ticked when the plan is archived.

## Plan Mode vs. a markdown plan — why this skill uses the file

<!--
Two approaches exist; pick the file for anything multi-step, Plan Mode for small tasks.

Claude Code Plan Mode (built-in)
  + Zero ceremony: plan in the conversation, approve, go.
  + Read-only phase prevents accidental edits while thinking.
  - The plan lives in the chat: lost on context compaction, new sessions, or a second developer.
  - No per-step status, no "what was actually done", no findings log — the history is gone after the work.
  - Hard to execute across days/sessions; every resume re-derives the state.
  - Reviewers see diffs, not the reasoning that produced them.

Markdown plan in the repo (this skill)
  + Persistent, versioned with the code where the repo tracks it, readable by anyone later ("why was .babelrc deleted?").
  + Survives context loss and sessions: the plan IS the state — resume from the first `[ ]` step.
  + Each step records what was done + what was found → doubles as the ticket's dev log and as input for follow-up tickets.
  + Forces small steps with named files and explicit verification; the developer checks each one.
  - More ceremony: the file must be kept honest (mark done, add notes, archive when finished) — stale plans are worse than none.
  - Slower start for tiny tasks; overkill for a one-file fix.
  - The developer must actually read/adjust the plan for the loop to add value.

Rule of thumb: >3 steps or >1 session or a ticket with acceptance criteria → markdown plan. Otherwise Plan Mode.
-->
