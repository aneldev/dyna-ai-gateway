---
name: sort-imports
description: Sort, group, and fix TypeScript/React import blocks for dyna-ai-gateway. Use when reordering imports, merging duplicates, or when the developer types `/sort-imports`. Apply silently on edited files when the import block was touched; do not run as a project-wide rewrite unless asked.
---

# TypeScript / React Import Sorting Rules

Apply these rules automatically. Do not ask. Do not "improve" or normalize paths. Output only the corrected import block.

**This Skill is the single source of truth for import layout.** ESLint does **not** order, group, blank-line, or dedupe imports — `import/order` and `import/no-duplicates` were removed because they cannot express this model (see below) and actively fought the fine proximity sort. The AI applies every rule in this document by hand.

ESLint's only import-related rules are unrelated to layout:
- `no-restricted-imports` — the AI SDK (`ai`, `@ai-sdk/*`) only inside `src/internal/llm-client/`.
- `object-curly-newline` (`ImportDeclaration.minProperties: 2`) — auto-collapses a single-member multiline import back to one line. See §5.

## ⚠️ Why ESLint does not enforce this

`eslint-plugin-import` cannot represent this model, so a partial config was worse than none:

- `import/order` treats **all** `../` as one flat `parent` group — it cannot subdivide by depth tier (§1.4), so it destroys the farthest-first proximity sort.
- It cannot order **interfaces-first / values-after** inside a merged import (§4).
- It cannot keep **design/UI/icons last** when they arrive as relative paths (`../ThemeProvider`) or non-matching patterns (§1.5).
- `import/no-duplicates --fix` merges duplicates onto a **single line** (`{a, b, c}`), violating one-member-per-line (§5); the fix needs `eslint-plugin-import-newlines`, which is not installed.

If a future maintainer wants lint enforcement, it requires a custom plugin — do not re-add `import/order` or `import/no-duplicates`.

## 1. Grouping & Order (top → bottom)

1. **External packages** — e.g. `react`, `dyna-error`, `@mui/*`
2. **Path aliases** — `#*` aliases into the repo (`package.json` `imports`). None today; when one is added it lives here, above the relative imports, and never overrides the proximity rule.
3. **Other absolute imports** — deep non-relative paths into the repo (a `baseUrl` import). None today.
4. **Relative imports** — `../` and `./`, sorted by **proximity**: farthest first (`../../../`), closest last (`./`). **Subdivided into one sub-block per depth tier**, each separated by exactly one empty line. The developer may split a tier further into topic blocks (see §2) — those blocks stay. Example:
   ```ts
   import cls from "cls-hooked";

   import ... from "../../../far-west/some";

   import ... from "../../something/some";
   import ... from "../../extrodinary/some";

   import ... from "../fabulus/some";
   import ... from "../intrvert/some";
   ```
   ⚠️ **ESLint does not order imports or police blank lines around them at all.** Depth-tier subdivision is not expressible in `import/order` (it treats all `../` as one `parent` group), so **the AI (this Skill) is the sole enforcer of ordering, grouping, and empty-line rules.**
5. **Styles / Icons / Assets / Theme** — always **last**, regardless of proximity and regardless of package. Only these:
   - styles: `*.less`, `*.css`, `*.module.less`, `sx*` helpers (`sxTransition`, `sxHover`, …)
   - icons: `@mui/icons-material/*`, `.../icons`, `graphics-*`, `createIcon` / `IconComponent`
   - assets: `getAsset`, image files (`*.svg`, `*.png`, `*.jpg`)
   - theme: `ThemeProvider` / `useTheme` / `Theme` / `SxProps`

   A component that merely *uses* an icon or theme (`IconButton`, `IconViewer`, `ThemeToggle`) is a normal import and is sorted by its own group.

## 2. Empty Lines

- Exactly **one** empty line between groups
- Exactly **one** empty line between depth tiers inside the relative-imports group (see §1.4)
- Internal repo packages always have their own block
- Never mix groups in the same block
- **Existing empty lines are meaning — keep them.** An empty line the developer placed between two imports of the same group is a deliberate sub-block (a topic, a feature, a depth tier, a package family such as `dyna-*`). Never remove it and never merge two such sub-blocks. Sorting happens *inside* a sub-block; sub-blocks keep their order and their members.
- Never collapse two empty lines into one and never add an empty line between two imports the developer kept together, unless §1 places them in different groups.

## 3. Duplicates

- Remove duplicates
- Imports from the same path must be merged

## 4. Merging Imports (mandatory)

If multiple imports reference the same path, merge them. Inside merged imports:

- **Interfaces / types first**
- **Values / functions after**

```ts
import {
  ITurn,
  ETurnRole,
} from "../../contracts";
```

## 5. Single vs Multi Imports

Single member → single line:

```ts
import {IUsage} from "../../contracts";
```

Multiple members → multiline, **one per line**:

```ts
import {
  IAIProfile,
  AIProfileStore,
} from "../ai-profile-store";
```

- Never use multiline syntax for a single import.
- Never put two named members on the same line inside a multi-import (e.g. `{a, b}` on one inner line is forbidden — each on its own line).

Enforcement:
- ✅ Single-item collapse: ESLint's `object-curly-newline` (`ImportDeclaration.minProperties: 2`) auto-fixes single-item multilines back to one line.
- ⚠️ Multi-item one-per-line: **AI-only.** ESLint does not enforce it (`eslint-plugin-import-newlines` is not installed) — the AI is the sole enforcer, so never leave two named members on the same inner line.

## 6. Formatting

- No spaces inside `{}`
- Trailing commas required in multiline imports
- Single imports stay inline
- Import paths must remain exactly as provided
- No comments inside import blocks
- Use double quotes

## 7. Sorting Inside Groups

- Sorting is based on **group priority**, not alphabetical order
- Relative imports are sorted by **path depth**, not name

## 8. Behavioral Rules

- Apply rules automatically
- Do not ask questions
- Do not "improve" or normalize paths
- Output only the corrected import block
