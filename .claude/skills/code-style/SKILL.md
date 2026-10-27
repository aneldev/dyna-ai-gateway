---
name: code-style
description: Code style rules that ESLint does NOT enforce (e.g. destructure-param layout). The root ESLint config is the source of truth for everything else — follow it without restating it. Invoke this skill ONLY when (a) writing code where an ESLint-uncovered layout rule applies, or (b) the user is explicitly reviewing / fixing style. Do NOT invoke on every routine edit.
---

# Code style

## ESLint is the source of truth

Root config: `eslint.config.*` / `.eslintrc.*`. Follow it. Do not restate or duplicate its rules in this file.

## Rules ESLint does not enforce

### Arrow-function single destructured param — keep inline

Keep `({` glued to the opening `(` and `})` glued to the closing `)`. Never wrap the destructure in an extra paren level.

```ts
// Correct
build: ({
  processInstance,
  stepInstance,
  lastStepEvent,
  siblingStepInstances,
}) => { ... }
```

```ts
// Wrong — extra outer paren level around the destructure
build: (
  {
    processInstance,
    stepInstance,
    lastStepEvent,
    siblingStepInstances,
  },
) => { ... }
```
```ts
// Wrong — inline destruction in any form
build: (
  {processInstance, stepInstance, lastStepEvent, siblingStepInstances},
) => { ... }
```

Same rule for any callback / method whose single param is an object destructure (`map`, `then`, event handlers, etc.).

### Method / function declarations take one object and destructure it in the signature — never `args`

Defaults go into the pattern, so the signature shows them; the body never reads `args.x`. When every property is optional, add `= {}` after the type. Unimplemented skeleton members (`throw new Error("Not yet implemented")`) keep `_args`.

**Layout (declarations — methods and exported functions):** the parameter goes on its own lines inside the parentheses, indented one level, with a trailing comma; the pattern and the type literal open on the same line. This is the declaration form (`PatchUpdater.loadPatchesHistory`, `vCardDownload`); the glued `({ … })` form above is for callbacks only.

```ts
// Correct — two or more properties
public async listModels(
  {
    enabledOnly = true,
    provider,
  }: {
    /** Skip disabled entries. Default true. */
    enabledOnly?: boolean;
    provider?: EModelProvider;
  } = {},
): Promise<IModelInfo[]> {
  return this.models.filter(model => !enabledOnly || model.enabled);
}

// Correct — one property: pattern inline, still on its own line
public async getModel(
  {modelId}: {modelId: string},
): Promise<IModelInfo> { ... }
```

```ts
// Wrong — the object is named and read in the body
public async listModels(args?: {enabledOnly?: boolean}): Promise<IModelInfo[]> {
  const enabledOnly = args?.enabledOnly ?? true;
  ...
}

// Wrong — glued to the parentheses (that layout is for callbacks)
public async listModels({
  enabledOnly = true,
}: {
  enabledOnly?: boolean;
} = {}): Promise<IModelInfo[]> { ... }
```

