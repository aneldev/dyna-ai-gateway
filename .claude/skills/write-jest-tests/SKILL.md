---
name: write-jest-tests
description: Write Jest unit tests for a the main export of the file. This would be a util (class/function) or react component of any type. Each test covers exactly one behavior/feature. Use when asked to add tests, write unit tests, or cover a function with tests.
---

## Goal

Write small, focused Jest tests where **each test checks exactly one behavior**.
Never pack multiple unrelated assertions into a single test.

This is a **two-phase workflow**. Always complete Phase 1 and wait for approval before doing Phase 2.

---

## Phase 1 — Plan (skeleton file, no implementation)

### Step 1 — Read the target file and map its public API

Read the file. The subject under test is its **main export** — a function, class, or React component.

Tests must cover the **public API**:

- **Function**: every parameter in the signature
- **Class**: every public method and each method's parameters
- **React component**: every prop

Read the **JSDoc** carefully — it is the primary source of truth for what each parameter does, its default value, and edge conditions. If there is no JSDoc, infer behavior from the code, the TypeScript types, and the parameter names.

If you find a contradiction between the JSDoc and the code, ask the developer to fix it before proceeding.

For each parameter / prop, determine:

1. What it does when provided with each meaningful value or state
2. What happens when it is omitted (optional params, documented defaults)
3. Whether its effect changes depending on another parameter — those interactions need combination tests

The test plan should be exhaustive across the API surface. Every parameter must appear in at least one test. Parameters that interact must appear together in at least one combination test.

### Step 2 — Decide the test file path and count

Place all test files in a `test` folder **inside the same directory as the source file**.

**Single file** — use when the total planned tests are few enough that the implemented file will stay under 100 lines:

```
src/foo/MyUtil.ts   → src/foo/test/MyUtil.test.ts
```

**Multiple files** — use when the implemented file would exceed 100 lines. Split by top-level group (method for a class, prop section for a component). Each file is named `<Subject>.<group>.test.ts`:

```
src/foo/MyUtil.ts   → src/foo/test/MyUtil.runPatches.test.ts
                    → src/foo/test/MyUtil.resetPatches.test.ts
                    → src/foo/test/MyUtil.resetToPatch.test.ts
```

**Decide at Phase 1 time.** Count the planned `test.todo` entries. If the total exceeds ~8 tests, a 100-line budget is likely too tight for one file — split into one file per top-level group from the start.

### Step 3 — Write the skeleton file(s)

Create the skeleton with `describe` / `test.todo` blocks only — **no implementation code**.
Use `test.todo` for every planned test so each file is valid TypeScript and runs without error.

Group by method (for classes) or by parameter/prop (for functions and components).

**Single-file example:**

```ts
import {MyUtil} from '../MyUtil';

describe('MyUtil', () => {
  describe('checkMissingItem', () => {
    test.todo('returns the missing key when one item is absent');
    test.todo('returns null when all items are present');
  });
});
```

**Multi-file example** — one skeleton file per method:

`MyUtil.runPatches.test.ts`
```ts
import {MyUtil} from '../MyUtil';

describe('MyUtil — runPatches', () => {
  describe('patches parameter', () => {
    test.todo('runs all patches in order on a fresh install');
    test.todo('skips patches before the last recorded cursor');
    test.todo('throws on duplicate patchId');
  });

  describe('neededForNew parameter', () => {
    test.todo('skips the patch when neededForNew is false on a fresh install');
    test.todo('runs the patch when neededForNew is false on an existing install');
  });

  describe('maxRetries + retryExhaustionResetMins interaction', () => {
    test.todo('retries up to maxRetries times before throwing');
    test.todo('resets retry state after retryExhaustionResetMins minutes have passed');
  });

  describe('onProgress callback', () => {
    test.todo('calls onProgress with correct patchNo and patchOfTotal');
    test.todo('does not throw when onProgress is omitted');
  });
});
```

`MyUtil.resetPatches.test.ts`
```ts
import {MyUtil} from '../MyUtil';

describe('MyUtil — resetPatches', () => {
  test.todo('calls deletePatchEvents with patchIds "all"');
});
```

Only imports and `describe`/`test.todo` structure. No variables, no mocks, no assertions.

### Step 4 — STOP and wait for approval

After writing the skeleton, **stop completely**. Do not proceed to implementation.

Tell the developer:
> "Test plan written to `<file path>`. Please review the test names and confirm, or tell me which tests to add, remove, or rename."

Do not implement anything until the developer explicitly says to proceed.

---

## Phase 2 — Implement (after developer approval)

### Step 5 — Fill in each test

Replace each `test.todo` with a real `test` body.
Each test exercises exactly one parameter value, state, or interaction.

**Structure:**

```ts
describe('<ClassName or functionName>', () => {
  describe('<method or parameter group>', () => {
    test('<what happens, in plain English>', () => {
      // arrange
      // act
      // assert
    });
  });
});
```

Use `test` (not `it`) to match the codebase style.

**Good test names — specific and outcome-focused:**

- `'skips patch when neededForNew is false on fresh install'`
- `'throws when patchId is duplicated'`
- `'calls addPatchEvent with error null on success'`
- `'does not call onProgress when omitted'`

**Bad — too broad, no outcome stated:**

- `'works correctly'`
- `'handles all edge cases'`

### Test Priority Order

**Always assert what the function returns. Never assert what it called.**

1. **Output assertions first** — assert the return value of the function under test
2. **State assertions second** — assert observable state changes if relevant
3. **Interaction assertions last** — only when output/state cannot verify the behavior

**Rule:** Use `toHaveBeenCalledWith` / interaction assertions ONLY when:
- The function returns `void` or `Promise<void>`
- The side effect cannot be observed via any return value (fire-and-forget, logging, email)

If the function returns **anything** — an array, an object, a boolean, a mapped result — test the returned value first.

**Correct pattern — output-first:**

```ts
// ✅ Set up mock to return specific data, assert what comes back
mockSearch.mockResolvedValue([makeMockDbRow({patchId: 'p-42'})]);
const results = await unit.loadHistory({skip: 0, limit: 10});
expect(results[0].patchId).toBe('p-42');

// ✅ Use mockImplementation to make behavior depend on input params
mockSearch.mockImplementation(({skip, limit}) =>
  Promise.resolve(skip === 5 && limit === 20 ? [row] : []),
);
const results = await unit.loadHistory({skip: 5, limit: 20});
expect(results).toHaveLength(1);
```

**Wrong pattern — interaction-first on non-void function:**

```ts
// ❌ Checks what was called, not what was returned
await unit.loadHistory({skip: 0, limit: 10});
expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({skip: 0, limit: 10}));
```

**Mandatory comment for interaction-only tests:**

When a function is non-void but interaction testing is the only option, add this comment:

```ts
// Interaction-only: <reason the return value cannot verify this behavior>
expect(mockCreate).toHaveBeenCalledWith(...);
```

Omitting this comment on an interaction assertion for a non-void function is a bug.

---

### Assertions

- Prefer one `expect` per test.
- Allow two `expect` calls only when they verify the same logical outcome (e.g. both `data` and `error` on a result object).
- Never assert two independent behaviors in a single test.

### Async tests

```ts
test('resolves with produced events', async () => {
  const events = await updater.runPatches();
  expect(events).toHaveLength(1);
});

test('rejects when patch throws', async () => {
  await expect(updater.runPatches()).rejects.toMatchObject({code: 53373563567073});
});
```

### Mocking — DB tests ALWAYS use the real DB

**Never mock DB entities, DB connections, or infrastructure layers with dummy jest.fn() objects.**

If the subject under test uses a DB entity (e.g. `DBPGEntity`, `DBLock`, or any class that calls a real DB), the test must connect to the real integration-test database.

#### Step 1 — Find the integration test connection before writing a single test

Before writing any test for a DB-backed class:

1. Find the `tenantId` used by integration tests in this project — look for `ECompany.INTERNAL_TEST` or equivalent in existing `*.test.ts` files near the subject.
2. Trace `tenantId` → `dbPGCodename` in `appConfig.ts`.
3. The env var used is `DBPG__<codename>__DIRECT__CONNECTION_STRING`.

#### Step 2 — Confirm with the developer before writing

Report exactly what you found and ask for confirmation:

> **DB connection for these tests:**
> - `tenantId`: `ECompany.INTERNAL_TEST` (`"internal-test"`)
> - `dbPGCodename`: `INTTEST`
> - env var: `DBPG__INTTEST__DIRECT__CONNECTION_STRING`
>
> Shall I proceed with this connection?

Do not write any test code until the developer confirms.

#### Step 3 — Write integration tests using the real DB

Follow the pattern from `DBLock.test.ts`:

```ts
import {ECompany} from '../../../config/ECompany';
import {MyFeature} from '../MyFeature';

const TENANT_ID = ECompany.INTERNAL_TEST;

beforeAll(async () => {
  const instance = new MyFeature({tenantId: TENANT_ID});
  await instance._dangerous_dropTable();
  await instance.migrateOrFail();
});

afterEach(async () => {
  // clean up data written by this test
  await new MyFeature({tenantId: TENANT_ID}).resetData();
});

test('stores and retrieves an item', async () => {
  const feature = new MyFeature({tenantId: TENANT_ID});
  const result = await feature.doSomething();
  expect(result.id).toBeDefined();
});
```

Key rules:
- `beforeAll`: drop + migrate (start from a clean schema)
- `afterEach`: reset/delete data written by each test (not the schema — just the rows)
- Each test uses its own `updaterId` / `lockId` / entity ID to avoid cross-test interference, OR relies on `afterEach` cleanup
- **No `jest.mock()` for DB modules** — never

#### When jest.fn() IS allowed

Only for:
- Pure callback arguments (`onProgress`, `onError`) passed to the SUT
- Non-DB side effects that genuinely cannot be observed (email sending, analytics)
- Timer overrides (`jest.useFakeTimers()`) when testing time-dependent logic

Always comment why:
```ts
const onProgress = jest.fn(); // callback — not observable via return value
```

### Snapshots

Use `toMatchSnapshot` only when the output is a large, stable, opaque structure (e.g. a grouped tree).
For all other values assert the exact expected value directly.

### React components

Use `@testing-library/react`. Test what the component renders and how it responds to interaction — never test internal state or implementation details.

```tsx
import {render, screen, fireEvent} from '@testing-library/react';

import {MyButton} from '../MyButton';

test('renders the label prop', () => {
  render(<MyButton label="Save" onClick={() => undefined} />);
  expect(screen.getByText('Save')).toBeInTheDocument();
});

test('calls onClick when clicked', () => {
  const handleClick = jest.fn();
  render(<MyButton label="Save" onClick={handleClick} />);
  fireEvent.click(screen.getByText('Save'));
  expect(handleClick).toHaveBeenCalledTimes(1);
});

test('is disabled when disabled prop is true', () => {
  render(<MyButton label="Save" onClick={() => undefined} disabled />);
  expect(screen.getByRole('button')).toBeDisabled();
});
```

One prop per test. Group props that control the same rendered region together only when they are genuinely inseparable.

### Step 6 — Apply import rules

Follow `r077-imports-formatting.md`:

1. External packages first
2. Internal repo packages second
3. Relative imports last, deepest path first

Single import → single line. Multiple → multiline with trailing comma. Double quotes.

```ts
import {dynaError} from 'dyna-error';

import {PatchUpdater} from '../PatchUpdater';
```

### Step 7 — TypeScript rules

- No `any` — use real types or define a minimal local interface.
- No non-null assertions (`!`) — use explicit guards or optional chaining.
- No comments in test files — the test name is the documentation.

### Step 8 — Run the tests

After implementing, run only the new test file from the package root:

```bash
pnpm test --run <path-to-test-file>
```

Fix any failures before reporting done.

Try 3 times to fix the same error, then as help from developer.

---

## Checklist before finishing Phase 2

- [ ] Every parameter / prop appears in at least one test
- [ ] Interacting parameters have at least one combination test
- [ ] All `test.todo` replaced with real implementations
- [ ] Each test checks exactly one behavior
- [ ] Test names are plain English sentences stating the outcome
- [ ] No test file exceeds 100 lines — split by group if needed (`Subject.group.test.ts`)
- [ ] No `any`, no `!` assertions
- [ ] Imports follow r077 order
- [ ] Tests pass: `pnpm test --run <file>`
