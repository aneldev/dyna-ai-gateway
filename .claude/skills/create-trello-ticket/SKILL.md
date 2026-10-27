---
name: create-trello-ticket
description: Create a new Trello ticket from the template card of the ticket's prefix (`<PREFIX>-xxxxx …_Template`; every prefix has its own template card on its own board — the skill knows no prefix, the developer names it). Use this skill whenever the user asks to create a Trello ticket, card, `<PREFIX>` ticket, or a new feature/bug/task card, even if they don't mention the template. Handles number bumping, title formatting, description DEMO-text replacement and checklist population. A ticket holds the WHAT (ACs, Dev ACs) — never implementation steps; those live in the plan of the `stepwise-plan` skill.
---

Source: https://claude.ai/chat/e4ddddee-7cb6-4640-a47c-cf5d0dfc8d0a

# Trello Ticket Creation (from the template card)

Create new tickets by cloning the template card of the ticket's prefix. Follow the steps in exact order. Do nothing beyond what is listed.

**What a ticket is for:** the goal, the acceptance criteria (ACs) and the developer acceptance criteria (Dev ACs). **Never** the implementation or its steps — the implementation is planned against the current codebase when the ticket starts, by the `stepwise-plan` skill, in `docs/plans/active/<TICKET> <title>.md`. The ticket's `Dev` checklist only points there (Step 5a).

## Prerequisites

- Trello MCP tools must be available (`trelloSearch`, `trelloReadCard`, `trelloReadChecklist`, `trelloWriteCard`, `trelloWriteChecklist`, `trelloWriteBoard`/`trelloReadList` as needed).
- **Prefix.** The ticket prefix (`DDE`, `DAIG`, …) decides the board, the list, the template card and the labels. **The skill defines no prefix and no default.** Take it only from the developer's words in the current request ("create a DAIG ticket"); **not mentioned → ask** (one question, combined with the title / bug questions below). Never infer it from the branch name, the docs, earlier tickets or an earlier run: a repo can carry several prefixes, and a wrong prefix bumps the wrong template.
- The user provides a short ticket title (the part after the number). If no title is given, ask for it — one question only (combine it with the prefix / bug questions).
- **Classify the ticket: bug or not.** A bug = something that already exists misbehaves (wrong result, error, crash, regression). Feature/task/improvement = not a bug. If the user's input does not make it clear, **ask** (`Is this a bug?`). The classification drives the labels (Step 3), the `Repro` section (Step 4) and the verification (Step 6).

## Step 00 — Existing plan / analysis files (mandatory, every run)

Before drafting Step 0, search the repo for plan or analysis Markdown that already covers the topic: every `docs/plans/active/*.md` and `docs/plans/archived/*.md` (at the repo root **and** in any nested `docs/` of a monorepo package, service or feature: `find . -path '*/docs/plans/*' -name '*.md' -not -path '*/node_modules/*'`), `docs/internal/*.md` (Roadmap steps, decisions), `temp/*.md`, and any analysis file the developer names. Do this **every time the skill runs**, even when it ran earlier in the session: files may have been added or changed since, or none existed at the beginning.

- **Found in `active`** → build the ticket from it (Goal, ACs, Dev ACs follow the plan's scope; name the file in `### Background & Context` as `Plan: <path>`), and in the approval gate list the files and what the ticket will change in each. After the card exists (Step 6), update those files: the ticket number and URL at the top, and their scope aligned with what was approved.
- **Found in `archived`** → the topic was completed or rejected. Say so in the approval gate with the file's path and status line; the developer decides whether this is a new ticket (a follow-up: name the archived plan under `Predecessor`/`### Background & Context`) or a mistake.
- **Not found** → say so in one line in the approval gate.

## Step 0 — Approval gate (mandatory, before ANY write)

Nothing is written to Trello (no template bump, no card) until the developer has **explicitly approved** the ticket content in chat.

1. Present, as plain chat text (not on Trello):
   - **Goal** — one sentence.
   - **ACs (user perspective)** — Given/When/Then list, what the user experiences.
   - **Dev ACs (developer perspective)** — the tools the ticket hands to developers: functions, hooks, components, config, where each lives and in which package, for server and for client code. This is the most important list; be concrete (names, signatures in words, locations). Dev ACs say **what** a developer gets, not **how** it is built — no implementation steps.
   - **Architecture** — only when the ticket introduces a new architecture or mechanism (a new storage, a new provider, a new data flow, a new layer). Describe how it works: parts, where data lives, the flow between them, why this and not the alternative.
2. Wait for the developer's answer. Revise and re-present until the developer says it is approved (e.g. "approved", "ok, create it"). Any change after approval re-opens the gate for the changed part.
3. Only then continue with Step 1. The approved ACs become the `ACs - Given When Then` checklist, the approved Dev ACs the `Dev ACs` checklist, the approved Architecture the `### Architecture` chapter (Step 4).

## Step 1 — Locate the template

The prefix is the only key: the template card is found by it, and the card's own `board` and `list` are the ticket's board and list. Nothing is hard-coded.

1. `trelloSearch` `search_cards` with query `<PREFIX>- Template` (searches every board the developer can see). Keep only the cards whose title matches `<PREFIX>-<number> <Name>_Template` (case-insensitive: `_TEMPLATE` counts). A search that returns nothing is not the end: list the boards (`trelloSearch` `search_boards` with `<PREFIX>`, then the lists of a matching board) before concluding.
2. Exactly one match → that is the template; its `board` and `list` are where the new card goes.
3. Several matches → ask the developer which one (show title, board, list of each).
4. **No match → stop and report it** to the developer: the prefix, the queries tried, the boards searched, and what fixes it (create a card `<PREFIX>-<number> <Name>_Template` on the board, or give the card's URL). Never fall back to another prefix's template, never create one, never guess the board.
5. Read the card fully: title, description, all checklists, labels (with ids), and custom field values (if the tools expose them).

## Step 2 — Bump the number

1. Extract the number from the template title (e.g. `20292`).
2. New number = template number **+ 1** (e.g. `20293`).
3. **Rename the template card** to carry the new number: `<PREFIX>-20293 <Name>_Template` (the name part stays as it is).
4. The new ticket uses the same new number: `<PREFIX>-20293`.

## Step 3 — Create the new card (mimic Trello's "Create card from template" button)

1. Create a new card **copied from the template** (use Trello's card-copy if the tool supports it, otherwise recreate manually). The copy must include:
   - **Description** — verbatim (rewritten in Step 4).
   - **ALL checklists** — every checklist of the template, in the same order, each with its template items in the same order, all unchecked. **Nothing more:** no extra checklists of any kind. The template's own `Dev` checklist is the only `Dev` checklist and gets exactly one item (Step 5a). When creating checklists one by one, see the cheat-sheet: `create` inserts at the top, so create them in reverse order.
   - **Labels** — exactly the template's labels (read from the template card in Step 1; the ids come with it). **Bug ticket:** the template's `dev` label is replaced by the board's `bug` label (look it up on the template's board; no `bug` label there → ask, never pick another).
   - **Custom fields** — copy the template's values if the tools expose them; if not, report it in Step 6 so the user copies them manually.
2. Keep the card in the same list as the template, **at the bottom** of that list (`pos: bottom` on create; the copy lands wherever the tool puts it otherwise).
3. Title format: `<PREFIX>-<newNumber> <User's title>` — e.g. `DDE-20293 Add SSO login`.
4. Target list: **always the template's list** (its id came with the template card in Step 1), bottom position. Never ask; the developer moves the card to its real list himself.

## Step 4 — Rewrite the description

The template description contains headings with **DEMO texts**. Each DEMO text explains (with an example) what content belongs under that heading.

- Replace every DEMO text with real content for this ticket.
- Content must be **as small as possible** and **super intuitive** — one short sentence or a few words per heading.
- Keep all headings. Do not add new headings (the only exceptions are `### Repro` for bug tickets and `### Architecture` for tickets that introduce a new architecture, both below). Do not leave any DEMO text behind.
- **Plan line:** when Step 00 found an active plan, the last line of `### Background & Context` is `Plan: <path>` (e.g. `Plan: docs/plans/active/DDE-20293 Add SSO login.md`). No plan yet → no line; the `stepwise-plan` skill adds it when the plan is written.
- **Predecessor / Successor:** when the developer names related tickets, they go in the `# Info` chapter, **right after the `PR: ---` line**, as **bare card URLs only** (no title, no markdown link — Trello renders the card's current title itself). Look each card up (`trelloSearch`) to get its URL; never guess. One card → one line; several → a list:

  ```
  PR: ---

  Predecessor: https://trello.com/c/IZqpdCVE
  Successor: https://trello.com/c/22324kk
  ```

  ```
  Predecessor:
  - https://trello.com/c/IZqpdCVE
  - https://trello.com/c/22324kk
  ```

  When the developer says "vice versa", also edit the other card's `# Info` chapter to point back (predecessor ↔ successor).

**Architecture chapter (only when the ticket introduces a new architecture, approved in Step 0):** append a new `### Architecture` heading at the **bottom** of the description (after the last template heading). It describes how the architecture works, so a developer reading the card understands the mechanism without the chat: the parts (functions, hooks, components, storage), where the data lives, the flow between them, and in one line why this and not the alternative. Short paragraphs or a short bullet list; a small table when parts/locations are listed. Not a task list — tasks belong to the plan file.

**Bug ticket only:** insert a new `### Repro` section **immediately before** `### Background & Context` (i.e. right after the `PR: ---` line). It holds the reproduction steps as a numbered list; every item starts with `Do:`, `Expected:` or `Observed:`:

```
### Repro

1. Do: Open the Invoices page
2. Do: Click the "New invoice" menu entry
3. Expected: The modal opens
4. Observed: The modal doesn't open and `TypeError: x is undefined` appears in the console
```

- `Do:` steps first (as many as needed), then exactly one `Expected:` and one `Observed:`.
- Several distinct reproductions → several numbered lists under the same heading, separated by a blank line (each list restarts at `1.`).
- If the user gave no repro steps, ask for them — one question — and never invent steps.
- Non-bug tickets get **no** `Repro` section.

## Step 5 — Fill checklists (ONLY these)

All template checklists already exist on the new card (Step 3). This step only decides which of them get ticket-specific content:

| Checklist | Action |
|---|---|
| Goal & Success Criteria | Fill with very short, meaningful items |
| ACs - Given When Then | Fill with very short Given/When/Then items |
| Dev ACs | Fill with the Dev ACs **approved in Step 0** (the tools developers get, one item each). If the developer defined none in the gate, leave it empty — never invent them. |
| Dev | Exactly **one** item — Step 5a |
| QA - Edge Cases & Test Scenarios | Fill **only if necessary**, very short items |

**Nothing else.** Any other template checklist keeps exactly its copied template items — do not fill, rename, reorder, or remove it.

Checklist item style: minimal wording, one idea per item. Example: `Given logged-out user, When opens /app, Then redirect to /login`.

## Step 5a — The `Dev` checklist: one item, no breakdown

The ticket never carries the implementation steps: they are planned when the ticket starts, against the codebase as it is then, by the `stepwise-plan` skill — and the plan file is their single home, so the two never drift apart. The template's `Dev` checklist therefore gets **exactly one item**:

- Plan already exists (Step 00 found it in `active`):
  ```
  Plan has been prepared in the codebase: `docs/plans/active/<TICKET> <title>.md`
  ```
- No plan yet (the normal case):
  ```
  Plan and implement with the `stepwise-plan` skill → `docs/plans/active/<TICKET> <title>.md`
  ```

`<TICKET> <title>` is the new card's title. In a monorepo the path starts at the closest `docs/` of the package, service or feature the ticket belongs to (e.g. `packages/server-app/docs/plans/active/…`); the `stepwise-plan` skill picks it, so the item may name only the file when the folder is not yet known: `… → docs/plans/active/<TICKET> <title>.md (closest docs folder)`.

Never add a second item, a second `Dev` checklist, or a task list anywhere on the card.

## Step 6 — Verify and report

1. Re-read the new card; confirm: correct title/number, no DEMO text remains, **all** template checklists present in the same order and no other, the `Dev` checklist holds exactly the one plan item, only allowed checklists filled, labels match the template. **Bug ticket:** labels are the template's with `bug` in place of `dev`, and the `### Repro` section sits right before `### Background & Context`.
2. Confirm the template card now shows the bumped number, and that the new card sits at the bottom of the template's list.
3. Report back: new card title, its list, and a link/ID. If custom fields could not be copied (Step 3), say so and ask the user to copy them manually.
4. Update the plan / analysis files found in Step 00 (ticket number and URL, scope aligned with the approved content). Report which files were updated. If in Step 00 no files were found, check the repo again now and proceed if they exist.

## Trello MCP cheat-sheet (verified 2026-10-22 — use these, do NOT rediscover by trial and error)

No ids live here: the board, the list, the template card and the labels are resolved from the prefix at every run (Step 1). Recording them would turn the skill into a default for one prefix, and a stale id silently writes to the wrong board.

Tool contracts:

- `trelloSearch`: `action: "search_cards" | "search_boards"`, param `query`.
- `trelloReadCard`: `action: "get"` requires `cardIdOrUrl` (URL works). No checklists in response.
- `trelloReadChecklist`: `action: "list_by_card"` requires `cardId` (full ARI).
- `trelloWriteCard`: actions `create | update | move | archive | mark_done | attach_label | detach_label`.
  - `create` takes `listId`, `name`, `desc` — **`labelIds` is silently ignored**; attach labels afterwards, one `attach_label` call per `labelId`.
  - `update` requires at least one of `name`/`desc`/`due` (cannot set labels).
- `trelloWriteChecklist`: actions `create | add_item | update_item | update`.
  - `create` takes `cardId` + `name` — **inserts at the TOP of the card**. Therefore create checklists in **reverse final order** (Finalize first, Goal & Success Criteria last) so the final order is correct with zero repositioning calls.
  - `add_item` takes `checklistId` + **`text`** (not `name`); appends at the bottom — add items in natural order.
  - `update` takes `checklistId` + `name` and/or `pos`; `pos` accepts only `"top"`/`"bottom"` (numbers rejected). Only needed to repair ordering mistakes.

Efficiency: there is no card-clone/bulk action — a full ticket is ~28 sequential write calls; keep every call correct on the first try using the contracts above.

**No delete:** these tools cannot delete a checklist or a check item (`trelloWriteChecklist` has only `create | add_item | update_item | update`). A wrongly created checklist or item can only be removed by the developer in Trello — so get the checklist set right *before* creating anything.

Custom fields: as of 2026-08-23 these tools have no read/write support for them (`trelloReadCard` omits them, `trelloWriteCard` has no action) — try once, then fall back per Step 3.

## Hard rules

- **Never write to Trello before the Step 0 approval** — ACs, Dev ACs and (when present) Architecture must be explicitly approved in chat first. No bump, no card, no checklist until then.
- **A ticket holds the what, never the how:** ACs and Dev ACs only. No implementation steps, no task breakdown, no extra `Dev` checklists — the `Dev` checklist has exactly one item that points to the plan (Step 5a). This applies to every ticketing platform, not only Trello.
- Never skip the template bump — it is the number source of truth.
- The prefix comes from the developer, never from the skill or the repo; no prefix means ask (Prerequisites).
- Never use another prefix's template — no template for the prefix means report and stop (Step 1).
- Labels come from the template only — never add labels beyond the template's, and never drop them. The single exception is the bug swap of Step 3 (`dev` → `bug`).
- Never invent repro steps — ask the user when a bug ticket comes without them.
- Never invent extra sections, members, or due dates unless the user asks.
- Shorter is always better than complete-sounding.