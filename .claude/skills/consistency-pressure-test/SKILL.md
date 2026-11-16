---
name: consistency-pressure-test
description: The pressure test that makes what was written right and consistent between the code, the JSDoc, the markdown docs and the glossary — checked in rounds until a round finds zero issues, at most 5 rounds, then the rest goes to the developer. Owns the contradiction rule (which side is right, by the evidence). Rounds are run by fresh reviewers (subagents without the author's framing), against the source line by line, a fixed table of edge cases, the defaults, absolute words and outside facts with a current source, with a repo-wide sweep after every fix. Holds the evidence rule: every claim and every behaviour of the code handed off has evidence (a `file:line`, a test, a run), or is listed as not verified. Run by the `implement-task`, `jsdoc-style`, `write-user-docs` and `stepwise-plan` skills before their work is handed off; use it also when the developer says "pressure test", "check consistency", "check for contradictions" or "zero-tolerance".
---

# Consistency pressure test — right, and the same everywhere

The goal: what was written is right, and the code, the JSDoc and the markdown docs say the same thing. A reader who
opens any one of them gets the same answer, and that answer is what the code does.

Read the work as a hostile senior reviewer would, not as its author: the goal is to find what is wrong, not to confirm
that it works.

## 0. The evidence rule

**Every claim and every behaviour handed off has evidence gathered for this unit**: a `file:line` read, a test that runs
the case, a command that ran. How plausible the work reads, or how sure the author feels, is not evidence: a model's own
confidence is not a measure anyone can check.

- **No evidence:** read the source, write the test, run it. When that cannot be done here, the item is listed under
  **Not verified** (section 7), never handed off as a fact.
- **A doubt the evidence does not settle** (two readings, a missing decision): ask the developer at once, with the doubt
  in one line and the reading you recommend first.

## 1. Who runs it, on what

| Caller            | Runs it on                                                                                          |
|-------------------|-----------------------------------------------------------------------------------------------------|
| `implement-task`  | The unit's code and tests, against the request and the design docs; every doc that states it        |
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

## 3. Who runs a round

The author of the work does not review it. Author and reviewer share the same framing, and the same blind spots.

- **Rounds are run by fresh reviewers**: subagents that get the pages (or blocks) of the scope, the source tree and this
  skill. They get no notes from the author, no summary of the intent, and no list of what is "already checked".
- **One reviewer per 3–4 pages** in a large scope, so each reviewer reads its pages and their code in full.
- **The author checks each finding against the code** (section 5) and fixes it. Then the next round goes to another
  fresh reviewer, over the whole scope and the diff.
- **Without subagents** (a one-line fix, a tool that has none): the author runs the round, and says so in the report.
  Such a round does not count as the pass of section 6.

## 4. One round — the checks

Every check is made against the source, read now: open the code, `grep` the name. Never from memory, never from another
doc.

1. **Facts against the code.** Every name with its exact spelling; the signature, what is optional and what is required;
   the defaults; the errors (codes, statuses, when they are thrown); the enum members; the shapes returned or emitted,
   field by field; the callers ("who uses it" names only callers that exist); every number. **Every claim about behaviour
   is backed by a `file:line` of the source, read in this round.** A claim backed only by another doc, by the JSDoc of
   the symbol or by memory is unverified, and counts as an issue until the source is read.
2. **Docs against docs.** The same fact says the same thing on every page and in every block. A fact is stated once; the
   other mentions link to it. **The sweep:** for every fact the work states, and again for every fact a fix changed, grep
   the whole repo, from its root, every package of a workspace included (all user docs, the FAQ, the tutorials, the
   README, the JSDoc and code comments) for its names and its wording. Every hit is in the scope of this round, also on
   a page or in a package the work never touched. A search inside one package misses the JSDoc of another package that
   describes the same function.
3. **JSDoc against the markdown.** A block and the page about the same symbol agree on every fact of check 1.
4. **Terms.** Every term is the glossary's term, used in the glossary's meaning. A term used two ways is an issue; a
   term the work needs and the glossary lacks is added to the glossary (one row, the table aligned).
5. **Examples.** Every code sample uses the API as it is today and would type-check. A sample that would not compile is
   wrong. **A sample that compiles is read as code that runs**: what each branch does for each kind of result the call can
   return, what an error does inside a loop, a timer or a callback (an unhandled rejection ends a Node process), whether
   a list the sample takes the first item of can hold several, and whether the code does what its comment says.
6. **Boundaries.** Every claim is checked against each case of this list that applies to it, in the code. The claim
   answers each one correctly, narrows itself to the cases it holds for, or the case is an issue:

   | Case                       | Ask                                                                                       |
   |----------------------------|-------------------------------------------------------------------------------------------|
   | First call vs continuation | Does it hold on a resume, a retry, a second page, a reload, a re-render?                  |
   | Variants of the entry      | Does it hold for each entry point (the simple and the full call, sync and async, CLI)?    |
   | Stop and failure           | An abort, a timeout, a thrown error, a refused call: what is reported, kept, billed?      |
   | Several at once            | Two items where the sample takes one; two calls in parallel; two instances of the server  |
   | Another actor              | A second user, another tenant, another role, the admin, an anonymous caller               |
   | Left out, empty, unknown   | The option omitted (the default), `[]`, `null`, a name nobody listed (fail open or closed) |
   | Order and concurrency      | Does "first", "before" or "then" hold, or do the parts run in parallel?                   |

7. **Defaults and fail-open.** For every option, permission or list the work names, write down what the code does when it
   is missing, empty or does not list an item, and check that the work says it. A gate that lets through what it does not
   name is the most common unstated fact.
8. **Absolute words.** Grep the work for *never*, *always*, *every*, *only*, *all*, *at worst*, *largest*, *eliminates*,
   *guarantees*, *open to*, *cannot*. Each one is backed by the code (check 1) or a source (check 9), or is narrowed. A
   page that sells (a landing page, a best practice, a README) gets this check word by word.
9. **Facts outside the code.** A claim about a provider, a price, a limit, a standard (OWASP, an RFC), a paper or a
   third-party library is checked against a current primary source (the vendor's documentation, the standard, the paper)
   in this round, and the source is named in the report. Without a source it is softened to what is known for sure, or
   removed. Never from memory.
10. **Code against the intent (a unit that changes code).** The code does what the request, the plan step and the design
   docs say, for each case of check 6 that applies, read in the code: each branch, each error path, each default, each
   caller of a changed signature. Each case has a test that runs it, or is named under **Not verified**. A case the code
   gets wrong is a bug of this unit, fixed before the handoff, not a sentence for the docs.
11. **Only when the work is a plan:** every step is the standard, mature way to do it; every side effect is named
   (callers, public API, tests, docs that go stale, the other plans in the tree); every acceptance criterion maps to a
   step, and no step works against the goal (the `stepwise-plan` skill lists what the plan itself must hold).

Where the contradictions hide (found in every audit so far): a dependency typed as the class in the doc and as its
interface in the code; a result shape that gained or lost a field; an enum member added to the code only; an argument
optional in the code and required in the doc, or the reverse; a table of outputs missing a field the code emits; a
number that was true when it was written ("~300 lines", "chars / 4"); a code comment that describes the previous
implementation; a sentence half true ("the memory stays the asker's" when one part of it does not).

## 5. A contradiction — which side is right

A disagreement between the code, the JSDoc and the docs is a **contradiction**: resolved in the same unit, never smoothed
over, never averaged into a sentence both sides could accept, never left for later.

1. **Find the truth.** The most recent deliberate change wins: `git log -p -S'<text>' -- <file>` or `git blame` on both
   sides says which one moved, and when. The code is usually the truth (a doc describes, the code does), but a doc
   changed after the code, with a decision behind it, means the code is the one behind.
2. **The evidence settles which side is right (step 1, the code, a test) → fix the other side now**, in the same unit: the design doc first (the
   source of truth), then every user doc that repeats it, then the JSDoc and the code comment next to it.
3. **The evidence does not settle it → ask the developer at once**, quoting both sides verbatim and the git evidence, the reading you
   recommend first. Do not write on before he answered: a later sentence built on the doubted one is a second copy of
   the error.
4. **The code is the wrong side.** A documentation unit changes no behaviour. The doc states what the code does
   **today** and names the gap in one sentence; the fix is a backlog entry or a ticket proposed to the developer, or (a
   few lines, no signature change, the behaviour the docs already promise, a test) a small local fix once he agreed.
5. **Not wrong, but odd** (a dependency declared and never read, a public method nobody calls, a declared default that
   is ignored): not a contradiction. Put it on the developer's observation list; fix nothing before he answers.

Never paraphrase a doc without reading the code; never change a doc to match a block just written; never delete the
sentence that contradicts instead of correcting it.

## 6. The loop — at most 5 rounds

1. **Run** every check of section 4 over the whole scope and list every issue (section 3 says who runs it).
2. **Fix** each issue (section 5 says which side), and run the sweep of check 2 for each fixed fact. A question only
   the developer can settle is asked at once (the recommended option first) and his answer is applied; asking is not
   a failed round.
3. **Run again**, over the whole scope, not only the fixed lines: a fix can create a new issue.
4. **Repeat until a round finds zero issues.** That round is the pass, and only when a fresh reviewer ran it (section 3):
   a round the author ran alone is never the pass. The pass also needs the rule of section 0: an open doubt is
   asked first, and what has no evidence is listed under **Not verified**, never counted as passed.
5. **Stop after 5 rounds** that still found issues. Fix nothing more; hand the rest to the developer, per problem:
   - what is wrong, in plain words, with a concrete example (no internal ids without their meaning);
   - why it matters;
   - 1–3 solutions, the recommended one first.

   He decides; apply his decisions and run one more round.

## 7. Report the result

The result is written where the work is reported:

- **A handoff** (`implement-task`): one line under **Verified**, `Consistency pressure test: passed after <n> round(s)`,
  who ran each round (fresh reviewers or the author), then one line per issue found: what it was → how it was fixed. Or,
  after 5 rounds, the open problems in the format of section 6. Name every check that was not made, e.g. "the abort case
  not checked" or "the OpenAI limit not checked against a source".
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
- **Confidence without evidence.** "It is surely right" after writing it is the author's feeling, not a check. Only a
  `file:line`, a test or a run counts, and the report names what has none.
- **The author as the reviewer.** The author reads what was meant, not what was written; the errors that survive are the
  ones the author shares with the work. Found in an audit: about 50 issues in pages the author had "passed" three times.
- **The happy path only.** A claim true for the first call and false on a resume, an abort or a second card reads as
  true until a user meets that case. The table of check 6 is run for every claim.
- **A sample that compiles taken as a sample that works.** Type-checking says nothing about a missing `catch`, the first
  item of a list that holds several, or a branch that shows what it should hide.
- **An outside fact from memory.** Provider limits, prices and defaults change; check the current source.
- **A selling sentence.** "At worst", "never", "the largest effect": the words that make a page attractive are the ones
  most often false.
