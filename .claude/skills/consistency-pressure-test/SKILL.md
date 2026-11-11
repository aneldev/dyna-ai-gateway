---
name: consistency-pressure-test
description: The pressure test that makes what was written right and consistent between the code, the JSDoc, the markdown docs and the glossary — checked in rounds until a round finds zero issues, at most 5 rounds, then the rest goes to the developer. Owns the contradiction rule (which side is right, the 98 % threshold). Run by the `jsdoc-style`, `write-user-docs` and `stepwise-plan` skills before their work is handed off; use it also when the developer says "pressure test", "check consistency", "check for contradictions" or "zero-tolerance".
---

# Consistency pressure test — right, and the same everywhere

The goal: what was written is right, and the code, the JSDoc and the markdown docs say the same thing. A reader who
opens any one of them gets the same answer, and that answer is what the code does.

Read the work as a hostile senior reviewer would, not as its author: the goal is to find what is wrong, not to confirm
that it works.

## 1. Who runs it, on what

| Caller            | Runs it on                                                                                          |
|-------------------|-----------------------------------------------------------------------------------------------------|
| `jsdoc-style`     | The blocks written or touched, against their code and every doc that describes the same symbols     |
| `write-user-docs` | The pages written or touched, against the code they describe and every doc that repeats their facts |
| `stepwise-plan`   | The plan, before it is presented; every step that writes docs or JSDoc, before its handoff          |
| The developer     | What he names                                                                                       |

A caller skill the repo does not have is simply not a caller there.

**The scope** is the work of the unit **plus everything that states the same facts**: grep each name, option and code
the work mentions across the code, the JSDoc, the docs and the README. A fact the work changed and another page still
states the old way is an issue of this unit.

## 2. The sources

| Source          | Where                                                                            | Says                                 |
|-----------------|----------------------------------------------------------------------------------|--------------------------------------|
| The code        | The sources, the tests (they pin the behaviour)                                  | What the product does: the reality   |
| The JSDoc       | The blocks on the symbols (it ships in the `.d.ts`, so it is user documentation) | The contract, at the symbol          |
| The design docs | Where the repo has them (`docs/internal/`, the decisions, the class contracts)   | Why, and the intended contract       |
| The user docs   | `docs/`, the README                                                              | How to use it                        |
| The glossary    | The file named `*glossary*` or `*terminology*` (below)                           | One name per concept, and what it is |
| The plan        | `docs/plans/active/…`, only when the work runs under one                         | What is to be built                  |

The glossary has either name, depending on the repo:
`find . \( -path '*/node_modules' -o -path '*/build' -o -path '*/.docusaurus' \) -prune -o \( -iname '*glossary*' -o -iname '*terminology*' \) -print`.
A file that only covers one domain (e.g. `Billing documents terminology.md`) is that domain's glossary.

A source the repo or the unit does not have is skipped, never invented. **No plan is needed**: most units (a page, a
block, an ad-hoc fix) have none, and the test runs the same without it.

## 3. One round — the checks

Every check is made against the source, read now: open the code, `grep` the name. Never from memory, never from another
doc.

1. **Facts against the code.** Every name with its exact spelling; the signature, what is optional and what is required;
   the defaults; the errors (codes, statuses, when they are thrown); the enum members; the shapes returned or emitted,
   field by field; the callers ("who uses it" names only callers that exist); every number.
2. **Docs against docs.** The same fact says the same thing on every page and in every block. A fact is stated once; the
   other mentions link to it.
3. **JSDoc against the markdown.** A block and the page about the same symbol agree on every fact of check 1.
4. **Terms.** Every term is the glossary's term, used in the glossary's meaning. A term used two ways is an issue; a
   term the work needs and the glossary lacks is added to the glossary (one row, the table aligned).
5. **Examples.** Every code sample uses the API as it is today and would type-check. A sample that would not compile is
   wrong.
6. **Boundaries.** Invent concrete edge cases where one concept ends and the next begins (the empty list, the second
   user, the call that is resumed, the option left out) and check that the work answers each one correctly, or says
   nothing wrong about it.
7. **Only when the work is a plan:** every step is the standard, mature way to do it; every side effect is named
   (callers, public API, tests, docs that go stale, the other plans in the tree); every acceptance criterion maps to a
   step, and no step works against the goal (the `stepwise-plan` skill lists what the plan itself must hold).

Where the contradictions hide (found in every audit so far): a dependency typed as the class in the doc and as its
interface in the code; a result shape that gained or lost a field; an enum member added to the code only; an argument
optional in the code and required in the doc, or the reverse; a table of outputs missing a field the code emits; a
number that was true when it was written ("~300 lines", "chars / 4"); a code comment that describes the previous
implementation; a sentence half true ("the memory stays the asker's" when one part of it does not).

## 4. A contradiction — which side is right

A disagreement between the code, the JSDoc and the docs is a **contradiction**: resolved in the same unit, never smoothed
over, never averaged into a sentence both sides could accept, never left for later.

1. **Find the truth.** The most recent deliberate change wins: `git log -p -S'<text>' -- <file>` or `git blame` on both
   sides says which one moved, and when. The code is usually the truth (a doc describes, the code does), but a doc
   changed after the code, with a decision behind it, means the code is the one behind.
2. **At least 98 % sure which side is right → fix the other side now**, in the same unit: the design doc first (the
   source of truth), then every user doc that repeats it, then the JSDoc and the code comment next to it.
3. **Less sure → ask the developer at once**, quoting both sides verbatim and the git evidence, the reading you
   recommend first. Do not write on before he answered: a later sentence built on the doubted one is a second copy of
   the error.
4. **The code is the wrong side.** A documentation unit changes no behaviour. The doc states what the code does
   **today** and names the gap in one sentence; the fix is a backlog entry or a ticket proposed to the developer, or (a
   few lines, no signature change, the behaviour the docs already promise, a test) a small local fix once he agreed.
5. **Not wrong, but odd** (a dependency declared and never read, a public method nobody calls, a declared default that
   is ignored): not a contradiction. Put it on the developer's observation list; fix nothing before he answers.

Never paraphrase a doc without reading the code; never change a doc to match a block just written; never delete the
sentence that contradicts instead of correcting it.

## 5. The loop — at most 5 rounds

1. **Run** every check of section 3 over the whole scope and list every issue.
2. **Fix** each issue (section 4 says which side). A question only the developer can settle is asked at once (the
   recommended option first) and his answer is applied; asking is not a failed round.
3. **Run again**, over the whole scope, not only the fixed lines: a fix can create a new issue.
4. **Repeat until a round finds zero issues.** That round is the pass.
5. **Stop after 5 rounds** that still found issues. Fix nothing more; hand the rest to the developer, per problem:
   - what is wrong, in plain words, with a concrete example (no internal ids without their meaning);
   - why it matters;
   - 1–3 solutions, the recommended one first.

   He decides; apply his decisions and run one more round.

## 6. Report the result

The result is written where the work is reported:

- **A handoff** (`implement-task`): one line under **Verified**, `Consistency pressure test: passed after <n> round(s)`,
  then one line per issue found: what it was → how it was fixed. Or, after 5 rounds, the open problems in the format of
  section 5.
- **A plan** (when there is one): the plan's `## Pressure test` chapter: the date, the number of rounds, one
  line per issue and how it was resolved (the developer's decision included).

A pass claims only what was checked: a check that could not be made (a sample not compiled, a page not built) is named,
never counted as passed.

## Pitfalls

- **Checking only the lines just written.** The old sentence on another page that states the fact the old way is the
  issue the reader trips on.
- **Checking against another doc instead of the code.** Two docs that agree can both be wrong.
- **Re-running only the fixed lines.** The round is the whole scope, every time.
- **A sixth round of fixing.** After 5 rounds the open problems are the developer's: they usually mean a decision is
  missing, and more fixing only moves the problem.
- **"Passed" with a check skipped.** Name what was not checked.
