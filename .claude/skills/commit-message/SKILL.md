---
name: commit-message
description: Write the commit message for the work just done, into `temp/commit - <feature>.md` (one file per unit of work, so parallel sessions never share one; developer commits it himself). Use when the developer says "write a commit", "commit message", "write the commit for this", or types `/commit-message`. Scope comes from the pair-programming session when there is one, otherwise from the working-tree diff. Never runs `git commit`.
---

# Commit message — `temp/commit - <feature>.md`

The developer commits himself (`git commit -F "temp/commit - <feature>.md"`). This skill only writes the file. **Never run `git commit`, `git add`, or amend.**

## 1. Determine the scope — two sources, in this order

1. **Pair-programming session** (we implemented something together in this conversation): the conversation is the primary source for the *why* and the *reasoning* (root cause, alternatives rejected, what was verified). Cover everything implemented since the previous commit message was written (or since the session's last commit if none was written).
2. **No session context** (fresh session, or the changes were made without me): derive the scope from the repository:
   - `git status --porcelain` — changed + untracked files
   - `git diff` and `git diff --cached` — the actual changes
   - Read the changed files where the diff alone does not explain the intent.

**In both cases the diff is the ground truth for *what* is in the message.** Always run `git status` / `git diff` before writing, even in a pair-programming session: what we discussed but reverted must not appear, what we changed silently (lint fix, import sort) must.

If the intent behind a change cannot be inferred from the diff, ask one short question instead of guessing.

## 2. File and format

- **File:** `temp/commit - <feature>.md` at the repo root (`temp/` is gitignored). `<feature>` is the plan's feature tag for
  stepwise-plan work (`temp/commit - Result review.md`, `temp/commit - Tool errors.md`), otherwise one or two words that name the
  unit (`temp/commit - FAQ wording.md`). **One file per unit of work, never a shared `temp/commit.md`:** the developer runs
  several sessions in parallel (one plan each), and a shared file is overwritten by the other session between the handoff and
  the commit — a commit then carries another unit's message. Overwrite your own file; never read, write or delete another
  session's file; delete any stray `commit.txt`.
- **Line 1 — the subject — is plain text, no markdown** (it appears raw in `git log --oneline` / GitHub).
- **Line 2 empty.**
- **Body in markdown** — headings, bullet lists, `code spans`, **bold** are welcome. Wrap nothing; one paragraph per line.

## 3. Subject line

Pattern (from the repo history): `<TICKET> <kind>: <summary>`

- **`<TICKET>`** — from the current branch name (`DDE-20289-Bump-React-19…` → `DDE-20289`). No ticket in the branch → ask for it.
- **`<kind>`** — the ones in use: `dev` (feature / step work), `fix`, `impr`, `doc`, `ai` (CLAUDE.md, skills, memory), `cloud`, `comment`. Compound is fine when it clarifies the area: `ai-skill`, `cloud - doc`.
- **Stepwise-plan work** (see `stepwise-plan` skill): `<TICKET> (feat: <Feature>) dev: Step X.Y — <short summary>`. `<Feature>` is the plan's short
  name (one or two words, e.g. `Cancellation`, `Tool policy`): one ticket carries several plans, the tag tells them apart in the log.
- **`<summary>`** — imperative, specific, names the area (`AIGateway`, `HumanGate resume`). Use `—` (em dash) to separate the area from the detail. Aim for ≤ 90 characters; never wrap.

Examples from the log:
```
DDE-20324 dev: AIGateway — IGatewayInput split into IGatewayAskInput and IGatewayRunInput (D104)
DDE-20324 (feat: Cancellation) dev: Step 1.1 — IGatewayInput.abortSignal / timeoutMs, makeCallSignal
DDE-20324 (feat: Required profileId) dev: Step 2.1–2.3 — profileId is required on ask()/run()
DDE-20253 ai-skill - impr: create-trello-ticket-DDE
```

## 4. Body — what goes in, in this order

Write for the reviewer who reads this in six months without the conversation. Short commits (one-line changes, doc tweaks) get a 1–3 line body, no headings.

1. **Symptom / motivation** — one or two lines: what was wrong or missing, as observed (the URL, the error, the failing build).
2. **`## Cause`** (fixes) or context (features) — the actual mechanism, not "it didn't work". Name files, functions, versions. If the cause was surprising, say what was ruled out (e.g. "not related to X that landed in the same step").
3. **`## Fix`** / **`## Changes`** — bullet per logical change, each naming the file/area and the *why*, not a restatement of the diff. Behaviour changes and public-API changes get their own explicit bullet.
4. **`## Verified`** — bullets of what was **actually** run and its result (lint 0 errors, tsc clean on X, N tests pass, build exit 0, curl 200 …). Only claims that were really checked; leave out what was not run — never assert it as verified.

**The message describes this change and nothing else.** No TODOs, no "still to check / please test", no unrelated bugs found along the way, no next steps. Those belong in the session report and in the plan document. A commit message is read months later by someone asking "what changed here and why" — a stale to-do list only misleads them. Single exception: one line about something deliberately left out *of this change*, when it is needed to understand the change's boundaries (e.g. "the Sentry SDK stays on v7 — separate ticket").

## 5. After writing

Reply with 2–4 lines: the subject line, the source used (session or diff), and any assumption or unverified claim the developer should confirm before committing. Do not paste the whole file back.
