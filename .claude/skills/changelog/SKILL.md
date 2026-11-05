---
name: changelog
description: Update the `## [Unreleased]` list of every `CHANGELOG.md`, each from what changed in its own folder since the last release: commits first, checked against the diff, completed from the plan. Use ONLY when the developer asks for it: "update the changelog", "write the changelog", or `/changelog`. It is the single owner of the changelog; no other skill writes to it. Never commits.
---

# Changelog — extracted from the commits, on demand

The commits of this repo are clean and explain the why, so the changelog is **derived from them**, not written unit by
unit. This skill runs when the developer asks, and only then.

## 1. Scope — every `CHANGELOG.md`, each with its own folder

```bash
git ls-files '*CHANGELOG.md'                                          # every changelog, one pass per file
base=$(git log -1 --format=%h --grep='^Release <package> v')          # <package>: the name in the file's package.json
git log --no-merges --format='%h %s%n%b' "$base"..HEAD -- <folder>
```

- **A file tracks only what changed in its own folder and deeper** (`<folder>` is where the file lives). A commit that also
  touches other folders counts here only for the part inside this one.
- The range starts at the last `Release <package> v…` commit, not at `main`: it covers the current branch, and also what
  was merged after the release and never entered the changelog. A merged PR is one squash commit, so its body stands for
  the whole branch.
- No `Release` commit for the package (never released, or no `package.json`): the range starts at `git merge-base main HEAD`.
  Say so in the handoff.

## 2. Read the sources, in this order

1. **The commits are the base.** Read the body, not only the subject: they say what changed and why.
2. **The diff is the check.** `git diff "$base"..HEAD -- <folder>` confirms what the commits claim and shows what they left
   out. Where they disagree, the diff wins; every name in an entry must exist in the code with that spelling.
3. **The plan adds what the first two lack.** Most work has one: the commit's ticket gives
   `docs/plans/active/<TICKET> *.md` or `docs/plans/archived/<TICKET> *.md`. Take from it only what the reader of the
   changelog needs: the intent of a change, what it decided for the user, why something breaks and how to move on.
   Leave out its steps, findings, rejected options and everything else. No plan: go on without one.

## 3. Keep what a user of the package sees

| Keep                                                                  | Drop                                                        |
|-----------------------------------------------------------------------|-------------------------------------------------------------|
| An exported symbol, a config key, a default or a behaviour, changed   | Refactors with no visible effect, private or `internal` API |
| A bug a host could hit, fixed                                         | Tests, tooling, the dev sandbox, lint rules, CI             |
| A method of a class or interface a host can replace in `overrides`    | Skills, plans, private docs, docs-only commits, JSDoc only  |

- **Net effect only.** A change made and undone in the range is not listed; several commits on one feature are one entry.
- **Breaking is decided by the code, not by the subject.** A removed or renamed export, a removed member of an exported
  interface, a changed default: breaking, even when the commit calls it a cleanup. Look for "breaking" in the bodies too.
- Nothing kept for a file: say so and leave it as it is.

## 4. Update the list under `## [Unreleased]`

The list under `## [Unreleased]` is the only thing this skill changes. It must read, after each run, as the true list of
what the range changed: add what is missing, correct what is out of date, remove what no longer holds. Never a second
entry for the same change: the skill runs many times in a range.

Format: [Keep a Changelog](https://keepachangelog.com). Groups, in this order and only when not empty:
`### Breaking changes`, `### Added`, `### Changed`, `### Fixed`, `### Removed`.

- Never edit a released section, and never add a version section: `pnpm release` turns `[Unreleased]` into the version,
  and aborts when it is empty, so run this skill before a release.
- **Short.** One or two lines per change; the changelog says what changed, the docs say how it works. Only a breaking
  change takes more room.
- **An entry names the user-facing change, not the work behind it:** no step, observation (`O6`), plan, ticket number or
  commit hash, and no link to the private docs. Write for the developer who only has the npm package.

**Every breaking change carries three parts, in this order** (Dennis, 2026-10-29). The commits do not hold them: write them
from the diff and the plan.

1. **What breaks and who is affected**: the symbol or config key, and which hosts (every host, or only one that overrides
   a class, builds a request itself, …).
2. **The migration**: the steps, with a before / after code sample that compiles.
3. **An AI prompt that performs the migration**: a fenced `text` block the user pastes into their coding assistant. It
   stands alone: it names the package and the version, the exact symbols, the before and after shapes, where to look in
   their code (a search term), and how to verify (`tsc` passes, the tests pass). It never points at the private docs.

## 5. Hand off

Report, per file, the range, the entries added or changed, and the commits dropped that were a close call. **Never commit:** the edit
waits for the developer's review, like any other file.
