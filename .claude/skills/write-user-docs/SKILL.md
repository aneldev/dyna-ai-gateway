---
name: write-user-docs
description: How to write or change any documentation meant for the users of dyna-ai-gateway — every file under `docs/` except the private `docs/internal/`, `docs/plans/` and `docs/implementation/`, the README, each package's `CHANGELOG.md`, and JSDoc (it ships in the `.d.ts`). Use whenever a task adds or edits a user doc, when the developer says "document this", "update the docs", "write the guide", or when a code change makes a user doc stale. Not for the private working docs (Roadmap, Classes, Blueprint, plans): those follow their own conventions.
---

# Write user docs — the final product, for the people who use the library

Two kinds of documents live in this repo and they must never blend:

| Kind                 | Where                                                                            | Audience                                              | Content                                                                                   |
|----------------------|----------------------------------------------------------------------------------|-------------------------------------------------------|-------------------------------------------------------------------------------------------|
| Private working docs | `docs/internal/`, `docs/plans/`                                                  | the developer and the AI building the library         | the analysis, the decisions log (D…), the milestones, the plans — **the source of truth** |
| User docs            | everything else under `docs/`, `README.md`, each package's `CHANGELOG.md`, JSDoc | the developer who installs and uses `dyna-ai-gateway` | what the library **is** and how to use it                                                 |

The private docs leave the repo before the library is published. A user doc that points at them breaks that day.

## The flow of every change

1. **`docs/internal` first.** The Roadmap (a decision **D…** when a contract or rule changed), the Classes contracts,
   the Blueprint. Nothing is documented for users before it is settled there.
2. **Then the user docs the change touched**: the architecture docs, the getting-started docs, the practices, the README,
   the JSDoc of the changed symbols.
3. **`docs/architecture/Decisions.md`** is derived from `docs/internal` **and** the codebase: the decision as it stands
   in the code, grouped by the class it concerns, in the user's words.
4. **Consistency is part of "done".** All docs agree with each other and with the code. When the code and a doc
   disagree, the code is the reality; fix `docs/internal` first, then the user doc.

## Rules for a user doc

- **Describe the final product.** What the library does today and how to use it. No brainstorming, no alternatives
  that were considered, no history of how it got here, no "to review", no "(Claude, 2026-…)", no milestone or step.
- **Never reference the private docs.** No path, no file name, no "see the Roadmap". A decision worth the user's
  attention is an entry of `docs/architecture/Decisions.md`, headed by its id (`### D46: …`): the id is public. A user doc
  or a JSDoc cites it as `(D46)` or links the entry; a D-number without an entry in `Decisions.md` is a private reference
  and must not appear.
- **Target the user's task.** Open with what the reader gets; then how to do it; then the limits. The reader has
  not read the code and never will read the internals.
- **No fluff.** No praise of the design, no "simply", no "powerful", no restating the heading in the first sentence.
  One idea per sentence. Tables for parallel facts, prose for one line of argument.
- **DRY, with Markdown links.** A fact lives in one document; every other document links it
  (`[Resume on another profile](../architecture/Live%20adjustment%20and%20dependency%20injection.md#32-resume-on-another-profile)`).
  No copy of a paragraph that exists elsewhere.
- **Names are the code's names.** Classes, config keys, methods and enum members exactly as exported; a backtick on
  each. Internal classes the user never constructs are named only where the user meets them (a config key, an error).
- **Code samples compile.** Imports from `dyna-ai-gateway`, the config shape of `IAIGatewayConfig`, the real method
  signatures. A sample that would not type-check is wrong.
- **Professional register.** Present tense, active voice, no first person, no jokes, no emoji.
- **Headings are navigable.** Numbered `##` chapters when a doc is long enough to cross-link; a chapter per class only in
  `Decisions.md`, a chapter per task elsewhere.

## The changelog — `packages/<package>/CHANGELOG.md`

One per published package, in the [Keep a Changelog](https://keepachangelog.com) format: `## [Unreleased]` on top, then
`## [<version>] - <YYYY-MM-DD>` per release, newest first. Groups, in this order and only when not empty:
`### Breaking changes`, `### Added`, `### Changed`, `### Fixed`, `### Removed`.

- **Every unit that changes what a user of the package sees** (an exported symbol, a config key, a default, a behaviour)
  adds its line under `[Unreleased]` in the same unit. The version bump renames `[Unreleased]` to the version and opens
  a new empty one.
- **Every breaking change carries three parts, in this order** (Dennis, 2026-10-29):
  1. **What breaks and who is affected**: the symbol or config key, and which hosts (every host, or only one that
     overrides a class, builds a request itself, …).
  2. **The migration**: the steps, with a before / after code sample that compiles.
  3. **An AI prompt that performs the migration**: a fenced `text` block the user pastes into their coding assistant. It
     stands alone: it names the package and the version, the exact symbols, the before and after shapes, where to look
     in their code (a search term), and how to verify (`tsc` passes, the tests pass). It never points at the private docs.
- A line names the user-facing change, not the work behind it: no step, no plan, no ticket number.

## JSDoc is a user doc

JSDoc ships in the `.d.ts` files and in editor tooltips. The `jsdoc-style` skill owns its templates; this skill adds the
audience rule: never link `docs/internal` or `docs/plans` from a JSDoc. Link a user doc under `docs/` or nothing.

## Checklist before handing off

- [ ] `grep -rn "docs/internal\|docs/plans\|Smartness\|milestone\|M[0-9]\.[0-9]" docs README.md src` finds nothing outside
      the private docs; every `D[0-9]+` cited in `docs/`, `README.md` or `src/` has a heading in `Decisions.md`.
- [ ] Every name in the doc exists in `src/` with that spelling.
- [ ] Every fact appears once; the other mentions are links.
- [ ] A reader who only has the npm package could follow the doc.
- [ ] A user-visible change has its line under `[Unreleased]` in the package's `CHANGELOG.md`; a breaking change has its
      three parts: what breaks, the migration, the AI prompt.
