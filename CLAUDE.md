# CLAUDE.md — dyna-ai-gateway

Server-only TypeScript library: the AI gateway. A pnpm workspace (D120): the gateway is `packages/dyna-ai-gateway`, its
storage adapters are sibling packages (`packages/dyna-ai-gateway-mongodb`, `-postgres`, `-s3`: placeholders until M7).

## Workspace layout

- **`src/…` in this file, the skills and the docs means `packages/dyna-ai-gateway/src/…`** — the gateway's sources; the private and
  user docs stay at the repo root (`docs/`), they cover the whole workspace.
- The tooling is installed and configured once, at the root, and every package extends it: `tsconfig.base.json` → `tsconfig.json`,
  `.eslintrc.js` (+ `.eslintrc.base.js`) → `.eslintrc.js`, `jest.config.base.js` + `jest.setup.ts` → `jest.config.js`,
  `webpack.dist.config.base.js` + `webpack.loaders.js` + `webpack.plugins.js` → `webpack.dist.config.js`, `babel.config.json`.
  A package holds only its own dependencies, paths and overrides. The root `README.md` has the table.
- Every package is a `dyna-ts-module-boilerplate` package; a new one is a copy of an adapter package's folder with its name changed.
- The root scripts run every package (`pnpm -r`); one package: `pnpm --filter <name> <script>` or the script inside `packages/<name>/`.

## Read first

- `docs/internal/AI Gateway Roadmap.md` — **Working rules 1–16** (they are binding), the decisions table (D…), the milestones.
- `docs/internal/AI Gateway Classes.md` — the class contracts. `docs/internal/AI Gateway Blueprint.md` — classes and connections.

## Stack

Node 24, pnpm 10, TypeScript 5.9, Vercel AI SDK (`ai` 7, `@ai-sdk/*`), zod 4 (peer dependency), Jest 29 + ts-jest,
ESLint 8, webpack 5 (from `dyna-ts-module-boilerplate`), pnpm workspace.

## Git — commits

- **Never run `git commit` (or `git add`, amend, push) unless Dennis explicitly asks to commit in that same message.** A "commit this" covers that one task only; it never carries over to later work.
- "commit.md" / "write the commit" means: write `temp/commit - <feature>.md` only (skill `commit-message`; one file per unit, since
  **several sessions run in parallel in this tree** — never a shared `temp/commit.md`). Dennis commits himself.
- **No `Co-Authored-By` or any AI-attribution trailer** in commit messages, the commit files or PR descriptions.
- **Commit only the files you changed in this unit**, by path; the other sessions' files in the tree are not yours.
- An issue found during development that the current unit does not fix → propose it to Dennis as an entry of
  `docs/implementation/Backlog.md` (`[(security)] (<severity>) #INT<n> <bug|impr> <title>`); add it only after he agrees.
- The implement → "Ready for review" → review → commit cycle of every task is the `implement-task` skill (`.claude/skills/implement-task/SKILL.md`); `stepwise-plan` runs each step through it. "commit and proceed" / "CAP" = commit this unit, then start the next one.

## Documentation — two audiences, one flow

- `docs/internal/`, `docs/plans/` (`active/` ongoing, `archived/` completed or rejected) and `docs/implementation/` are **private working docs** (Roadmap, Classes, Blueprint,
  plans, the backlog): the source of truth of the analysis and of how the library is built. `docs/internal/` and `docs/plans/` are gitignored (`**/docs/plans/`, `**/docs/internal/`); `docs/implementation/` leaves the repo before it is published.
- Everything else under `docs/` is **for the users of the library**, written per the `write-user-docs` skill
  (`.claude/skills/write-user-docs/SKILL.md`): the final product only, no process, no fluff, no reference to the private docs.
- Flow of every change: 1. update `docs/internal` (the truth) → 2. update the user docs it affects →
  3. `docs/architecture/Decisions.md` is derived from `docs/internal` **and** the codebase → 4. all docs agree with each
  other and with the code. JSDoc counts as user documentation (it ships in the `.d.ts`).

## Commands

- Tests: `pnpm test-no-coverage [path]` (every package; the path is a jest pattern, so `src/tests/ask` and `packages/dyna-ai-gateway/src/tests/ask` both work) — real-provider tests (`*.real.test.ts`) read `AIGATEWAY_TEST_*` from the repo-root `.env` and are skipped when a key is empty; layout in `src/tests/README.md`
- Writing a test: follow `.claude/skills/write-gateway-tests/SKILL.md` — one test per file, the config in a sibling `<test>.config.ts` (`gatewayConfig<Scenario>`, spreads `gatewayConfigBase`)
- Lint: `pnpm lint` / `pnpm lint-fix` — the root `.eslintrc.base.js` holds the base rules, the root `.eslintrc.js` what every package shares, `packages/dyna-ai-gateway/.eslintrc.js` the gateway's own
- Types: `pnpm typecheck` — `tsc` over sources **and tests** (each package's `tsconfig.tests.json`); `tsconfig.json` excludes tests and ts-jest only warns, so this is the only check that fails on a type error in a test
- Build: `pnpm build` (every package: lint + typecheck + CJS + ESM + `.d.ts` into its `dist/`)
- Sandbox: `pnpm sandbox-cli <ask|run>` (chat) and `pnpm sandbox-debug` (inspector) run the config of `src/dev-sandbox/sandbox.config.ts` — point it at a test's `gatewayConfig<Scenario>`; keys from the repo-root `.env`

## Rules enforced by lint

- The AI SDK (`ai`, `@ai-sdk/*`) is imported only inside `src/internal/llm-client/`. One exception: `src/entries/vercel-ui/` (the Vercel UI module, D40) may import **types** from `ai`, never `@ai-sdk/*`, and reaches the gateway through the root barrel only (`"../.."`), never `src/internal`.
- **Every JSDoc or code comment you write or touch follows the `jsdoc-style` skill** (`.claude/skills/jsdoc-style/SKILL.md`): pick the template by symbol kind, never `@param`/`@returns`. Load the skill before writing it.
- After any import edit, apply the `sort-imports` skill (`.claude/skills/sort-imports/SKILL.md`): packages first, then relative by depth. Lint does not check import order.

---

# General rules

# ⚠️ TOP PRIORITY — See the Bigger Picture

**IMPORTANT: These rules override the default "answer the question as asked" behavior. Apply them to every task, before anything else.**

Don't face only the problem in front of you — face the **bigger picture**.

1. **Reframe before acting**
   - Step back and see the whole screen: What does the user *actually* want? What is the *reality* of the situation (not just the literal request)? What is the *best approach* for the user's real needs?
   - If the literal request and the real need diverge, say so and address the real need.

2. **Overview before delivering**
   - Before presenting anything, ask yourself: *"Is what I'm about to deliver the **right** thing for the user — or just a fast answer to save time and tokens?"*
   - If it's the fast answer, stop and do the right one instead.

3. **Problems are not the whole picture**
   - Don't tunnel-vision on the immediate error/symptom/question. Zoom out first, solve second.

---

## AI Assistant Conduct Rules

- **Suggest only mature, professional solutions** — no experimental or speculative approaches.
- **If I request an approach that is not the professional standard, STOP and say so before implementing it** — name the standard idiom, explain the tradeoff in 1–2 lines, and implement my request only after I confirm. Do not silently comply with a sub-standard approach just because I asked.
- **Do not guess** — only suggest something if you are at least 95% confident it will work. If uncertain, say so explicitly before suggesting.
- **Follow current best practices** — recommend what is standard *today*, not outdated patterns.
- **Do suggest alternatives or improvements** at the end, as a small table, but only proven ones.
- **Suggest always commonly used names and terminology** for methods, classes, tools, etc.

---

## Corrections block — teach me what I got wrong

I am the learner here. Wrong assumptions and wrong terminology are expected from me;
**silently fixing them teaches me nothing.**

- **Every answer** (not just code changes — explanations, reviews, plain chat) ends with a
  `## 📝 Corrections` block **if** I got something wrong in my input — a term, a fact, an
  assumption about how the code/system works, a wrong cause→effect.
- Nothing wrong → **omit the block entirely.** Never write "no corrections."
- Format, one row per mistake, no prose around it:

```
## 📝 Corrections
| You said | Correct | Why it matters |
| --- | --- | --- |
| "the cache invalidates on deploy" | It invalidates on schema version bump | Deploys don't always bump the schema version, so cache can go stale across a deploy with no schema change. |
```

- **What counts as a mistake:** wrong/nonstandard term, wrong fact, wrong cause→effect, mixed-up
  concepts, deprecated API/name used as current. Not typos, not grammar, not shorthand that clearly
  points at the right concept.
- Mark something wrong **only if factually false** — never for shorthand that already points to the
  right concept.
- Unsure whether it's an error or shorthand → **ask**, don't assert a correction.
- Keep the block **last** in the answer. Never bury corrections mid-answer.

## Terminology — one name per concept

The glossary of this repo is `docs/Terminology.md`, a user doc (`write-user-docs` skill). These rules apply in every
conversation, not only while planning:

- When I use a term that conflicts with the glossary, say so at once: "the glossary defines X as …, you seem to mean Y. Which is it?"
- When I use a fuzzy or overloaded term, propose the canonical one (the field's term, never an invented one) and name the synonyms to avoid.
- When I state how something works, check the code. A contradiction is surfaced, never smoothed over.
- A term resolved in the conversation goes into the glossary right then — one row, table re-aligned — not at the end of the plan. The glossary says what a term IS; no implementation detail.

## Prompt shorthand


`<number>c` in my prompt is a hard character budget for your next answer, not a suggestion.

**Multiplier rule:** if the number is below 100, multiply it by 100. It's an abbreviation. `1c` = 100, `7c` = 700, `12c` = 1200, `99c` = 9900. Numbers of 100 or more are taken literally (`200c` = 200). In ranges, apply this to each number separately (`2-5c` = 200–500).

| Shorthand | Means |
| --- | --- |
| `2c` / `200c` | Answer in 200 characters or fewer. |
| `5c` / `500c` | Answer in 500 characters or fewer. |
| `2-5c` / `200-500c` | Answer in 200 to 500 characters. |
| `from now on <number>c` or `<number>c from now on` (e.g. `from now on 3c` = 300) | Sticky: apply that budget to this answer **and every answer after**, until reset. The multiplier rule applies. |
| `from now on full` / `full from now on` | Reset: drop any sticky budget, go back to answering as before. |

- Counts the whole visible answer — prose, code, everything. Formatting (tables, headings, corrections block) still applies, but compressed to fit the budget; drop scaffolding before dropping correctness.
- Can't fit a correct answer in budget → say so briefly and give the shortest correct version, even if it overruns. Never silently truncate into something wrong or misleading.
- A sticky budget persists across turns until I send a reset phrase or a new sticky budget — a plain `<number>c` (non-sticky) on one turn does not clear it; it just overrides that single answer.

## Markdown files — tables are aligned

**Every table in a `.md` file you create or touch has padded, column-aligned cells**, so the pipes form straight vertical
lines and a human can read the table as source. Markdown renders an unpadded table fine, but I read these files raw.

- Pad every cell of a column (header, separator, body) to the width of the column's widest cell, one space on each side of the
  content; the separator row is dashes over the full width (`|----|`).
- When you edit one row of an aligned table and the new cell is wider, re-align the whole table — never leave one row sticking out.
- When you touch a file whose tables are not aligned, align them all in the same change.
- Does not apply to tables inside my chat answers (only to files) and never trumps correctness: content first, alignment second.

```md
| #  | Question                                   | Default                                                   |
|----|--------------------------------------------|-----------------------------------------------------------|
| Q1 | Drop `availability` from the check result? | Yes. Re-add it with a channel for a warning (follow-up).  |
| Q4 | `costUSD` (as asked) or `costUsd`?         | `costUSD`, as asked: consistent with `estimateCostUSD`    |
```

---

## Coding Standards

### TypeScript Naming Conventions

- **Interfaces**: Prefix with `I` (e.g., `IUser`, `IUserService`)
- **Types**: Prefix with `T` — use ONLY for unions and function types, NOT for object shapes (use interfaces)
- **Function Types**: Use `THandler` suffix (e.g., `TOnClickHandler`)
- **Enums**: Prefix with `E`, `UPPER_SNAKE_CASE` members (e.g., `EStatus.ACTIVE = "ACTIVE"`)
- **Classes**: PascalCase, no prefix (e.g., `UserService`)
- **Variables**: lowerCamelCase (e.g., `userService`, `currentUser`)
- **Internal-only**: Leading `_` ONLY when TypeScript visibility is insufficient

### Module Folder Structure (folders with a barrel)

For a folder that exposes an API through an `index*.ts` barrel (e.g. `src/internal/llm-client/`):

- The folder **root contains only files that the barrel exports** — the public API.
- Everything else is internal: move it to the folder's **`utils/` subfolder**. Internal helpers are not exported by the barrel, even when they look reusable — if the exported API provides their result, the helper stays internal.
- Consumers import from the barrel or relative paths **only**, never deep paths; files inside the folder import each other relatively.

### General Style

- Language: **TypeScript everywhere**, avoid `any` unless strictly necessary
- Prefer small, focused functions and React components
- Keep React state local; use dynadux for global state
- Prefer composition over inheritance
- Respect existing naming and folder conventions
- Keep files focused; avoid "god objects" and "god components"
- **No non-null assertions (`!`)** — never assert "I, the developer, guarantee this is not null/undefined". Developer guarantees rot: code moves, callers change, the value that was always set today becomes optional tomorrow, and the `!` silently lies. Use explicit guards (`if (!x) throw new Error(...)`) or optional chaining (`?.`) instead — they fail loudly when the assumption breaks. Enforced as an ESLint **error**.
- **Private methods go at the end of the file** — public API first, private helpers after
- **Every internal class of the gateway is `constructor(config: I<Class>Config, deps: I<Class>Deps)` and `implements I<Class>`** where the interface exists — the config is the class's own, the deps are the shared instances, the interface is what a host passes in `overrides` to replace the class.
- **Every function declares its return type** — arrow functions, methods, components (`JSX.Element`), hooks. Inference is not documentation: the declared type is the contract a reader and a caller see, and it fails loudly when the body drifts. Where the type is not importable, reach it through an exported interface (`IOwner['field']`), never with `any`.

---

## Architecture Rules

- Do not change the folder structure unless I explicitly ask.
- Do not introduce new cross-cutting frameworks or architectures on your own.
- Keep public APIs stable unless the task explicitly allows breaking changes.

---

## Working Method

For any **non-trivial** task:

1. **Plan first**
    - Break work into 5–10 very small steps.
    - Each step must list the files it will touch.
    - Prefer smallest possible changes.

2. **Then implement**
    - Implement at most 1–2 steps at a time.
    - Make minimal diffs; avoid large rewrites.

3. **Self-review**
    - Before presenting a patch, review for simplicity, single responsibility, and unnecessary abstractions.
    - If something can be simpler, simplify it first.

---

## Hooks

### hook-test-universal

**Event**: `PostToolUse` on `Edit` or `Write`
**Trigger**: After Claude modifies any `.ts` or `.tsx` source file.

**Behavior**:
1. Searches for related test files next to the edited file:
   - `FILE.test.ts`, `FILE.spec.ts` (same directory)
   - `__tests__/FILE.test.ts`, `__tests__/FILE.spec.ts`
   - `test/FILE.test.ts`, `tests/FILE.test.ts`
2. If test files are found, **ask** whether to run them — never run automatically.
3. Only proceed if I explicitly agree. If I ignore the question, do not run them.
4. Run with `pnpm test --run <testfile>` from the package root.
5. If tests fail, attempt to fix (max 3 iterations). Report remaining failures; skip silently if no test files exist.

---

## Critical Thinking — Patterns vs Reality

Think like a senior engineer who has been burned by over-abstraction. Before recommending a pattern, ask: **does this actually apply here, or am I pattern-matching to a textbook answer?**

- "Best practice" is not a justification. Name the tradeoff explicitly.
- It is correct to say "this pattern doesn't apply here." Saying so is better than applying it because it exists.

### When NOT to wrap a library

**Do not wrap to wrap.** Only wrap for a concrete reason:
- connection/lifecycle management
- key namespacing or prefixing
- serialization (e.g. JSON helpers)
- error normalization at a system boundary

Wrong to wrap: `ioredis`, `decimal.js`, `mongodb` driver, `sharp`, `moment`.  
OK to wrap: MUI (app-specific subset), OAuth flows (complex protocol).

The test: if the wrapper just re-exports every method with the same signature — delete it.

---

## DO and DO NOT

**DO**

- Ask clarifying questions when requirements are ambiguous.
- Explain your reasoning briefly when doing non-obvious changes.
- Prefer incremental refactors over "big-bang" rewrites.
- Keep changes local to the files mentioned in the current plan step.

**DO NOT**

- Do not introduce new dependencies without explicit permission.
- Do not create new layers, frameworks, or patterns "for cleanliness" only.
- Do not rewrite large files or modules unless I explicitly request it.
- Do not change unrelated code "while you are here".
- Do not generate huge monolithic functions or components.
- **Do not skip linting** (blocks deployment)
- Do not use `any` type without explicit reason
- Do not create object shapes with `type` (use `interface`)