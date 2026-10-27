---
name: implement-task
description: The implement → hand off → review → commit cycle of this repo, for ONE unit of work. Use it every time the developer asks to implement, build, make, change, fix or "proceed with" something — a step of a stepwise plan or an ad-hoc request — and whenever he answers a handoff with "commit", "commit and proceed" or "CAP". It covers what "done" means (tests, lint, JSDoc, docs), the handoff report with `temp/commit - <feature>.md` (one per unit: several sessions run in parallel in the same tree), the review round-trips, and the only way a commit is ever made (only the files of this unit, by path). Not for questions, reviews or explanations that change no file.
---

# Implement a task — one unit, one commit

The developer and Claude pair-program in a fixed rhythm. Claude implements and hands off; the developer reviews
everything except the tests in depth; nothing is committed until he says so, and then only the files of this unit.
The rhythm is the same whether the unit is a step of a `stepwise-plan` or a one-off "make X".

```
Dev:    "proceed with step 2.3" / "implement X" / "fix Y"
Claude: implement → verify → docs → temp/commit - <feature>.md → "Ready for review"       (never commits)
Dev:    review
        ├─ "change A, B"      → Claude changes, re-verifies, updates the commit file → "Ready for review"  (repeat)
        ├─ "commit"           → Claude commits THIS unit's files, deletes its commit file → stops
        └─ "commit and proceed" / "CAP" → the same commit, then the next unit starts in the same turn
```

## 0. Several sessions work in parallel

The developer runs **more than one session at a time**, each on its own plan (`stepwise-plan`) or unit, in the same working
tree. Everything in this skill assumes it:

- The working tree holds files of the other sessions: modified, untracked, half-done. They are not yours. Never stage,
  revert, format, "fix" or report them as broken; name them once in the handoff as "not part of this unit" and move on.
- Your commit message lives in **your own file**, `temp/commit - <feature>.md` (`<feature>` = the plan's feature tag, or one or
  two words naming the unit). A shared `temp/commit.md` was overwritten by the other session between a handoff and the
  commit, and the commit went in with the other unit's message. Never read or touch another session's commit file.
- Your plan file is yours; another session's plan file is not edited, even to fix a typo.
- A failing test or lint error that comes from another session's files is reported, not fixed; re-run to tell yours apart.

## 1. Scope the unit

The unit is exactly what the developer asked for in that message: one plan step, one fix, one feature slice.

- **Under a stepwise plan:** the step's **Files / Do / Verify** lines are the scope. Mark the step `[~]` first.
- **Ad-hoc request:** restate the scope in one line before starting if the request could be read two ways; otherwise go.
- Nothing "while I'm here". A pre-existing problem found on the way is reported in the handoff (and in the plan's
  **Findings** when there is a plan), fixed only if it blocks the unit.
- **Backlog.** A problem found on the way that this unit does not fix (bug or improvement): tell the developer, in
  the handoff or as soon as it matters, and propose a backlog entry for `docs/implementation/Backlog.md` (the heading
  `### [ ] [(security)] (<severity>) #INT<next free number> <bug|impr> <title>`, `(security)` only for a security issue, then the `####` sections **Short**, **Description**, **Repro**, as the
  file's Conventions say). Add it only after he agrees; the entry is part of this unit's files.
- Non-trivial and no plan? Say so and offer `stepwise-plan` instead of silently growing the unit.

**Read the docs before touching code.** Nothing in this library stands alone: the thing you implement is bound to
other classes, decisions and rules. Before the first edit, read the parts of `docs/internal/` that touch the unit —
the Roadmap's **Working rules** and the decisions (**D…**) in play, the contracts of the touched classes in
`AI Gateway Classes.md`, their connections in `AI Gateway Blueprint.md` — and the user docs that describe the behaviour.
Then name, in one line, what the unit relies on or changes (a decision, a contract, a rule). A unit that contradicts
a decision is not implemented quietly: say so first, and let the developer decide between the unit and the decision.

## 2. Implement

- Minimal diff; respect `CLAUDE.md` (naming, no `!`, declared return types, private methods last, no new deps).
- Every JSDoc or comment written or touched goes through the `jsdoc-style` skill — load it before writing.
- After any import edit, apply `sort-imports`.
- Tests: new or changed tests follow `write-gateway-tests` (one test per file, sibling `<test>.config.ts`).
  A behaviour change without a test is incomplete unless the developer said "no test".

## 3. Verify — with real commands, before claiming anything

Run what proves the unit; the handoff lists only what was actually run.

| Check | Command | Pass criterion |
| --- | --- | --- |
| Tests | `pnpm test-no-coverage [path]` for the touched area, then the full suite before handoff | no new failures vs. the baseline (plan Step 0.1, or the last green run) |
| Types | `pnpm typecheck` (sources and tests; `tsc --noEmit` alone skips the tests) | clean |
| Lint | `pnpm lint` | 0 errors; new warnings named in the handoff |
| Build | `pnpm build` | only when the public API, exports or packaging changed |

Something that cannot be verified here (needs a key, a browser, prod) is not verified — it becomes the developer's check.

## 4. Keep the docs honest

The developer reviews docs as code. Update, in the same unit, whatever the change made stale:

- JSDoc of every symbol whose behaviour or signature changed (section 2 covers the style).
- `README.md` when usage or config changed.
- `docs/internal/*` **first** — the source of truth: the Roadmap (a new decision **D…** when a contract or rule changed,
  the milestone step log), the Classes contracts, the Blueprint — exactly as the recent commits do.
- **Then every user doc** under `docs/` that describes the changed behaviour (`write-user-docs` skill says how). The unit
  is not done while a user doc or a JSDoc contradicts the code.
- The plan file (`docs/plans/…`) when under a stepwise plan: mark `[x]`, add the `Done <date>:` line, findings,
  deviations — the `stepwise-plan` skill says what goes where.
- `docs/implementation/Backlog.md` — go through the open entries (`[ ]`, `[~]`) and check whether this unit solves one,
  on purpose or on the way. Solved: mark it `[x]` and name the commit subject or plan step, as the file's Lifecycle says.
  Partly solved: keep it open and add what remains to its **Description**. Say in the handoff which entries you closed.
- `CLAUDE.md` when a command, rule or version it states changed.

## 5. Hand off

1. Invoke the `commit-message` skill: it writes `temp/commit - <feature>.md` (subject `<TICKET> <kind>: …`; plan steps use
   `<TICKET> (feat: <Feature>) dev: Step X.Y — …`, the feature tag being the plan's short name). The message describes this unit and nothing else.
2. Report, short and self-contained, in this order:
   - **Changed** — files, grouped by what they do.
   - **Docs relied on** — the decisions, contracts and rules the unit rests on or changed (section 1), and the backlog entries
     it closed (section 4), or "none".
   - **Verified** — each command run and its result (counts, not "all green").
   - **Your check** — what only the developer can verify, or "nothing".
   - **Commit:** the subject line, and "`temp/commit - <feature>.md` is ready" (the real file name).
   - End with **Ready for review.**
3. Ring the bell right before sending it — `( afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1 & )` from the Bash
   tool (the `stepwise-plan` skill, Phase 2, says why): the developer is in another session and hears that this one is ready.
4. Stop. Do not commit, do not start the next step. "Ready" means the developer's turn.

## 6. Review round-trips

When the developer asks for changes:

- Make exactly the changes asked; re-run the checks the change touches (the full suite again if code changed).
- Update `temp/commit - <feature>.md` so it describes the unit as it is now (the message is for the final diff, not a changelog
  of the review). Append nothing like "after review".
- Report again in the section-5 format, listing only what changed in this round, and end with **Ready for review.**

If a requested change contradicts a project rule or the plan, say so in one or two lines, then do what he decides.

## 7. Commit — only on his word, only this unit

A commit happens only when the developer's **current** message says "commit" (alone, or "commit and proceed" / "CAP").
An earlier "commit" never carries over; "looks good" is not "commit"; "commit.md" means write the file, not commit.

```bash
git status --porcelain                                # look first: what is in the tree (other sessions' files too)
head -1 "temp/commit - <feature>.md"                  # the subject must be THIS unit's; if not, stop and rewrite it
git add <each file of this unit, by path>             # never `git add -A` / `git add .`
git commit -F "temp/commit - <feature>.md"            # no trailers, no AI attribution
rm "temp/commit - <feature>.md"                       # the file goes: a leftover commit file confuses the developer
git log -1 --oneline
```

- **Only the files you changed in this unit**, staged **by path**: the files the handoff listed, plus the docs and plan edits
  of the unit. Every other modified or untracked file in the tree (another session's plan, his own work in progress, a stray
  IDE reformat) stays where it is — name them in the reply, never add, revert or clear them.
- The message is **your** `temp/commit - <feature>.md` as reviewed. Read its first line before committing: if it is empty,
  stale or names another unit, write it again with `commit-message` before committing; do not improvise a message and do
  not commit with a message you did not check.
- Never amend, never push, never `--no-verify`.
- Reply with the hash and the subject line, and that your commit file is deleted.

**"commit and proceed" / "CAP":** do the commit above, then in the same turn start the next unit — under a plan, the
first `[ ]` step (section 1 onwards). Without a plan, ask what the next unit is. The next unit ends with its own
handoff (section 5); the commit permission does not extend to it.

## Pitfalls seen in this repo

- Committing on an old permission ("commit this" two tasks ago) — the developer's rule is absolute: a commit needs the
  word in the same message.
- `git add -A` sweeping in files the developer had open in the IDE.
- A commit file left over from the previous unit and reused, or found later and mistaken for an open unit — hence the
  delete right after every commit (Dennis, 2026-10-21: an empty or stale commit file in `temp/` confuses him).
- A shared `temp/commit.md` across two parallel sessions: session B wrote its message after session A's handoff, A's "commit"
  took B's message, and A's cleanup wiped B's message. Hence one file per unit, and the subject line read before every commit.
- Reporting "tests pass" after running one folder — the full suite runs before every handoff.
- Treating "Ready for review" as the end of the unit and starting the next step unasked.
