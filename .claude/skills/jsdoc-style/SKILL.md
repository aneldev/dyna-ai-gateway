---
name: jsdoc-style
description: How to write JSDoc and code comments in dyna-ai-gateway. Four templates by symbol kind — class (About / Who needs it / What needs / Usage / Pitfalls), interface (short goal + who needs it), property (description, purpose, when to use, @example, @default), public method / exported function (the class template, empty sections dropped), private method / helper (telegraphic one-liner). TypeScript-native — never `@param` / `@returns`. Use whenever you author, review or rewrite a JSDoc block or a code comment, including when you create a new class, interface, config option or property.
---

# JSDoc & Comment Style

Apply these rules automatically when you write or edit a JSDoc block or a code comment. Do not ask.
**First decide what kind of symbol you are documenting, then use that kind's template.** Public API
(classes, public methods, exported functions) gets the full template. The telegraphic one-liner is for
private helpers only.

| Symbol | Template | Length |
| --- | --- | --- |
| `class` | §1 — full block with `#` sections | As long as the sections need |
| Public method / exported function (utils) | §1 — the same block, empty sections dropped | As long as the sections need |
| `interface` / `type` | §2 — short description + who needs it | 2–6 lines |
| Property / field / config option / enum member | §3 — description, purpose, when, `@example`, `@default` | 1–10 lines |
| Private method / local helper / getter / callback | §4 — telegraphic contract | 1–5 lines, cap ~20 |
| Inline `//` | §8 — WHY only | 1–2 lines |

## 1. Classes, public methods, exported functions — the full template

Every exported class, every **public** method of a class and every **exported** function (utils) gets this block. Fill every placeholder; the sections marked *if any* are dropped
when there is nothing to say — never left as an empty heading, never padded.

```ts
/**
 * <Name of the class for humans> -- <expanded name>
 *
 * # About
 *
 * > <Quote: one sentence that captures the class, like a tagline>
 *
 * <Why this class exists — its purpose>
 *
 * <Goals, as a bullet list>
 *
 * <This class on the bigger screen: where it sits in the gateway, what comes before and after it>
 *
 * # Who needs it
 *
 * <Who calls it — another class, the orchestration code, the host app — and why they would need it>
 *
 * # What needs                                       ← if any
 *
 * <Dependencies it takes: deps, stores, adapters, config it cannot work without>
 *
 * # Usage
 *
 * ## When to use it
 *
 * <Situations it is made for>
 *
 * ## When shouldn't use it
 *
 * <Situations where another class / a plain call is the right tool>
 *
 * # Pitfalls                                         ← if any
 *
 * <What the caller must not do; ordering, lifecycle, cost or security traps>
 */
export class ContextAssembler { ... }
```

Rules for the class block:

- The first line is the title: human name, two dashes, expanded name.
  `ContextAssembler -- builds the one model request out of the ten inputs of a call`.
- Headers (`#`, `##`) are allowed **only** in a §1 block, exactly the ones above, in this order.
- "Who needs it" names concrete callers that exist in the code (`prepareCall`, `DynaAIGateway.ask`), not "anyone".
- "What needs" lists the constructor deps by name; a class with no deps drops the section.
- Never link or mention `docs/internal` or `docs/plans` (the private working docs): JSDoc ships in the `.d.ts` files
  and in editor tooltips, so it is user documentation. Link a user doc (`See docs/architecture "…".md § …`) or nothing.

The same block on a **public method** or an **exported function**:

- Title: `methodName -- <what one call does>`, e.g. `assemble -- builds the model request for one call`.
- `# About`: the tagline, the purpose and the goals of this one operation; the "bigger screen" line says
  where in the flow the call happens (`prepareCall` calls it after the KB retrieval, before the LLMClient).
- `# Who needs it`: the concrete callers of this method, not of the class.
- `# What needs`: the preconditions — state the instance must be in, what must have been called before,
  what the arguments must already contain. Arguments themselves are typed inline (§5), never listed here.
- `# Usage`: when to call this method and when another method of the same class is the right one.
- `# Pitfalls`: ordering, idempotency, cost (an LLM call inside), side effects.
- Empty sections are dropped. A public method whose whole story is one sentence (`getById`, `clear`) still
  gets the title line plus `# About` with the tagline; it never gets padded sections.
- The class block tells the class story once; a method block never repeats it — it links: `See the class JSDoc.`
- **An interface and the class that implements it carry the same JSDoc on every member — repeated, not linked.** A
  `/** See \`IFoo.bar\`. */` on the class method sends the reader elsewhere, and no editor shows the linked text in the
  tooltip. Copy the block; when one side changes, change both (the developer, 2026-10-27).
- Overloads: one block on the first signature.

```ts
/**
 * assemble -- builds the one model request for a call
 *
 * # About
 *
 * > Ten inputs in, one request out.
 *
 * Joins the active profile, the rendered system prompt, the thread history, the KB excerpts and the
 * memories into a single `IModelRequest`, trimmed to the model's context window.
 *
 * - Deterministic: the same inputs produce the same request.
 * - Never calls a model; it only arranges text.
 *
 * Runs inside `prepareCall`, after the KB retrieval and before `LLMClient.complete`.
 *
 * # Who needs it
 *
 * `prepareCall` for `ask` and for every run step.
 *
 * # What needs
 *
 * The retrieval must already have happened; it receives the `IRetrievalResult`, it does not search.
 *
 * # Pitfalls
 *
 * History is trimmed from the oldest turn; callers that need an old turn kept must pin it in the context input.
 */
public assemble(input: IContextInput): IAssembledContext { ... }
```

## 2. Interfaces and types

```ts
/**
 * <Short description, and the goal of it>
 *
 * <Who needs it — the class/function that takes or returns it — and what it depends on>
 */
export interface IContextAssemblerConfig { ... }
```

- Two paragraphs, 2–6 lines total. No headers, no bullet lists.
- The members get their own property JSDoc (§3); the interface block never lists them.
- A `type` alias (union, function type) gets the same two paragraphs.

## 3. Properties — interface members, config options, class fields, enum members

```ts
/**
 * <Short description>
 *
 * > <Purpose — what the value is for>
 *
 * <When to use it, and when not>
 *
 * @example <value, as code> - <the logic behind that value>
 *
 * @default <default value, if the property is optional>
 */
maxTurns?: number;
```

- Fill what applies, drop the rest. A property whose name says everything keeps only the
  `<Short description>` line (or, for an optional one, description + `@default`).
- `@example` is a value plus the reasoning: `@example 20 - keeps a long chat under the context window`.
  Several examples → several `@example` lines.
- `@default` is mandatory on every optional property that has a runtime default. Write the literal:
  `@default 20`, `@default "markdown"`, `@default false`. No default at runtime → no `@default`.
- Enum members use the same template; `@default` never applies.

```ts
// ✅ Minimal — the name is enough
/** Thread the turn belongs to. */
threadId: string;

// ✅ Optional with a default
/**
 * Upper bound of history turns kept in the request.
 *
 * > Keeps long chats under the model's context window.
 *
 * Lower it for small-context models; raise it when the host app already trims history.
 *
 * @example 20 - a chat of normal length fits a 128k model with room for the KB excerpts
 *
 * @default 20
 */
maxTurns?: number;
```

## 4. Private methods, local helpers, getters, callbacks — telegraphic

Everything that is not public API: `private` / `protected` methods, non-exported functions, trivial getters,
inline callbacks. The JSDoc answers **"what do I need to know to USE this symbol"** — nothing more.

- **1–5 lines preferred.** Hard cap: **~20 lines**.
- Lead with the rule, contract, or constraint. No re-stating the symbol's name or type.
- Rationale, history and trade-offs belong in the §1 block of the public symbol that calls it, not on the helper.
- If a JSDoc only restates the name or the type — delete it.
- A one-liner `/** ... */` is a one-liner only if it fits ~100 chars. Longer → multi-line block,
  one idea per line.

```ts
// ❌ One-liner that's no longer a one-liner
/** Atomic read-current + write-new on the same row. Partial patch — fields not present are left untouched. */
update: (...) => Promise<...>;

// ✅ Wrapped — one idea per line
/**
 * Atomic read-current + write-new on the same row.
 * Partial patch — fields not present are left untouched.
 */
update: (...) => Promise<...>;
```

## 5. No `@param` / `@returns` / `@type` — this is TypeScript

TypeScript already types params, returns and properties. **Never** add `@param`, `@returns`, `@type`,
`@arg`, `@argument`. They duplicate the signature and rot when it changes.

A parameter or return value that needs explanation gets the **property template (§3) inline at the
declaration site** — right above the param or field.

```ts
// ❌ Don't
/**
 * Charge a customer.
 * @param customerId  The Stripe customer id.
 * @param amount      The amount in minor units (cents).
 * @returns The charge id.
 */
async function charge(customerId: string, amount: number): Promise<string> { ... }

// ✅ Inline JSDoc on the params that need it
async function charge(
  customerId: string,
  /** Amount in minor units (cents). */
  amount: number,
): Promise<
  /** Stripe charge id. */
  string
> { ... }

// ✅ Object args: JSDoc each field at the field declaration (destructured in the signature)
async function charge(
  {
    customerId,
    amount,
  }: {
    customerId: string;
    /** Amount in minor units (cents). */
    amount: number;
  },
): Promise<string> { ... }
```

## 6. Allowed JSDoc tags

- `@example <value> - <logic>` — see §3; on a §1 block a short call under `# Usage` is fine.
- `@default <literal>` — optional properties with a runtime default (§3).
- `@deprecated <reason + replacement>` — single line.
- `@see <path or symbol>` — a related symbol or doc section.
- `@todo` — only an actionable item; pair with a ticket if relevant.

No `@param`, `@returns`, `@type`, `@author`, `@version`, `@since`, `@private` (TS `private`),
`@readonly` (TS `readonly`), `@override` (TS).

## 7. Shared contracts on grouped members

When several members share one contract (e.g. all storage writes must be atomic), put **one short block**
at the top of the region and a **one-liner pointer** on each member.

```ts
//#region "Storage"

/**
 * Atomicity: every `processInstance.update` and `stepInstance.create` inside
 * one `dispatchEvent()` must commit together (single DB transaction).
 */
processInstance: {
  /** Atomic with the same-call `stepInstance.create(s)`. */
  update: (...) => Promise<...>;
};
//#endregion "Storage"
```

## 8. Code comments (inline `//`)

Comment **only** when the WHY is non-obvious — a hidden constraint, an invariant, a workaround, surprising behaviour.

- Don't explain WHAT the code does — well-named identifiers do that.
- Don't reference the current task, the ticket id, or callers ("used by X"). Those rot.
- Past ~100 chars → break onto a second `//` line.
- A `// Todo:` is fine. One line, actionable.

## 9. Markdown inside JSDoc

- Backticks for symbol references: `` `processInstance.update` ``, `` `dispatchEvent()` ``.
- `> quote` only for the tagline (class) and the purpose line (property).
- `**bold**` for the load-bearing word, sparingly.
- Headers (`#`, `##`) only inside a §1 block (class, public method, exported function). Nowhere else.
- No emojis.

## 10. Self-check before saving

1. Which kind is it — class / public method / exported function / interface / property / private helper?
   Did I use **that** template?
2. §1 block: all sections present (or dropped because empty), in order, `Name -- expanded` title?
   Method block repeating the class story instead of linking it? → cut.
3. Property: optional with a runtime default → is `@default` there? Non-obvious value → `@example value - logic`?
4. Private helper: can it be deleted (name + type say it all)? Over ~20 lines? One-liner past ~100 chars?
5. Any `@param` / `@returns`? → rewrite inline (§5).
6. Headers outside a §1 block? → remove.
