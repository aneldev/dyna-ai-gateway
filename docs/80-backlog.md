# Backlog

Issues found during development, outside the scope of the task that found them. Each one waits here until it is picked up
as its own task.

## Conventions

### Heading

`### [ ] [(security)] (<severity>) #INT<number> <bug|impr> <title>`

Status mark at the **front**: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (with reason).
`(security)` only when the issue is a security issue: a tenant or user boundary is crossed, data leaks, an unauthorised
action runs, or input is trusted unchecked. Cost, load, data loss or a code smell alone is not.
`<severity>`: `Critical` · `High` · `Medium` · `Low`.
`<number>`: the next free number, starting from 1200; a number is never reused.
`bug`: the code does something wrong. `impr`: it works as designed, the design should be better.

### Sections of an entry

`#### Short` (one line), `#### Description` (what and why, with the code location), `#### Repro` (steps that show it).
Optional: `#### Covered by` (the ticket that will fix it), `#### Found in` (the task that found it).

### Lifecycle

When an entry is picked up, mark it `[~]` and name the ticket under `#### Covered by`. When it is done, mark it `[x]` and
put a `Done <date>, <ticket or commit>: <what closed it>` line under the heading.

## Entries

### [x] (High) #INT1200 bug Concurrent calls overshoot the daily budget

Done 2026-10-24, DAIG-20330: the gateway holds no budget any more; `check` carries the `traceId` and a token estimate, so
the application's adapter reserves in `check` and settles in `addUsage`
([Usage guard](20-learn-the-gateway/060-usage-guard.md) shows it).

#### Short

The budget is check-then-spend; K parallel calls each spend up to the remaining budget.

#### Description

`BudgetGuard.check` reads the remaining budget and `LLMClient.account` charges after the call. Nothing
reserves between the two, so K concurrent calls all pass the check: overshoot ≈ (K−1) × remaining, plus one step per run.
`ask` also leaves `maxOutputTokens` out of its estimate. The fix needs an atomic reserve-and-settle on the usage
repository (a change to the adapter contract).

#### Repro

Set a tenant's daily cap so one call fits and two do not; start two `ask` calls on two threads of that tenant
at the same time (`Promise.all`); both answer, and the ledger ends above the cap.

#### Covered by

DAIG-20330 (reserve in `check`, settle in `addUsage`).

#### Found in

DDE-20324 Security checkup.

### [x] (Medium) #INT1201 bug A failed ledger write makes the call free

Done 2026-10-24, DAIG-20330: `addUsage` follows every approved `check`, also for a failed or aborted call; a `check` that
throws denies the call (fail closed), an `addUsage` that throws is logged with an internal error code.

#### Short

When the charge throws, `LLMClient.account` only logs it; the call is never charged.

#### Description

`src/internal/llm-client/LLMClient.ts` `account()` catches the error of `budgetGuard.charge` and writes
`console.error`. No retry, no report hook: a ledger that is down lets every call through free, and the application is never told.
Belongs with the reserve-and-settle contract (#INT1200).

#### Repro

Give the gateway a usage repository whose write throws; run `ask` several times: every call answers, the
ledger stays at 0, the only trace is `LLMClient: the call [...] could not be charged` in the console.

#### Covered by

DAIG-20330 (`addUsage` after every approved check).

#### Found in

DDE-20324 Security checkup.

### [x] (Medium) #INT1202 impr Per-user share of the tenant's daily budget

Done 2026-10-24, DAIG-20330: every `check` and `addUsage` carries `userId` (and profile, model, kind, thread, run); a
per-user share is the application's rule in its adapter.

#### Short

The budget is per tenant only; one user can spend the whole tenant's day.

#### Description

The ledger key is `tenantId + day`. A product decision and a key change (`tenantId + userId + day`) are
needed; the storage adapters would carry it.

#### Repro

User A of a tenant runs calls until the tenant's cap is reached; user B of the same tenant now gets the budget
error on the first call.

#### Covered by

DAIG-20330 (`userId` on every check).

#### Found in

DDE-20324 Security checkup.

### [ ] (Medium) #INT1203 impr No cap on tool calls per step or on their concurrency

#### Short

A model can request N tool calls in one step; all run at once and all outputs enter the next request.

#### Description

There is no `maxToolCallsPerStep` and no concurrency limit: the profile's `parallelToolCalls` only switches between all
at once (the default) and one at a time. Up to N × 50 000 chars (`DEFAULT_MAX_OUTPUT_CHARS` in
`src/internal/tool-registry/ToolRegistry.ts`) enter the next model request: cost and load on the application's backends
grow with whatever the model asks. Needs a cap as a new profile option.

#### Repro

With `FakeLLMClient`, return one step with 30 calls of the same tool; all 30 `execute` run at the same time
and the next request carries all 30 results.

#### Found in

DDE-20324 Security checkup.

### [ ] (Low) #INT1204 impr No cap on files per call or on the inlined bytes

#### Short

A call accepts any number of files, and all their bytes are inlined into the model request.

#### Description

Nothing limits `files.length` per call or the total bytes inlined; today only the application's request-body
limit stops it. Needs a config option (e.g. `fileStore.maxFilesPerCall` and a byte total).

#### Repro

Call `ask` with 100 small files attached; the gateway accepts them all and sends them all to the provider.

#### Found in

DDE-20324 Security checkup.

### [ ] (Low) #INT1205 impr No cap on the KB document size at ingest

#### Short

`KbIngestor` accepts a document of any size.

#### Description

A very large document is chunked and embedded in full: embedding cost and storage are unbounded. The size
cap is a new `KbIngestor` config option.

#### Repro

Ingest a 50 MB text document; it is accepted, chunked and every chunk is embedded.

#### Found in

DDE-20324 Security checkup.

### [ ] (security) (Low) #INT1206 impr Uploaded bytes are not checked against the declared `mime`

#### Short

A file's `mime` is trusted as declared; the bytes are never inspected.

#### Description

Checking magic numbers would catch a mislabelled file before it is stored and sent. Needs a dependency
decision (e.g. `file-type`). Today the provider refuses a mismatch.

#### Repro

Upload a ZIP's bytes declared as `image/png`; the file store accepts it, and the failure appears only when the
provider rejects the request.

#### Found in

DDE-20324 Security checkup.

### [ ] (Low) #INT1207 bug `AIProfileStore`'s cache never evicts

#### Short

One cache entry per `tenantId` ever seen, also unknown ones, kept for the process lifetime.

#### Description

`src/internal/ai-profile-store/AIProfileStore.ts` keeps `cache = new Map<string, ITenantCache>()`; the
TTL reloads an entry and an admin write drops it, but nothing removes it by age or size. Memory grows with the number of
distinct tenantIds; it matters only when the application passes unauthenticated tenantIds. Fix: a bounded LRU.

#### Repro

Call `ask` with 100 000 random `tenantId`s (each fails); the map holds 100 000 entries afterwards.

#### Found in

DDE-20324 Security checkup.

### [ ] (security) (Medium) #INT1208 bug The user erasure is per process

#### Short

The erasure tombstone lives in one process; another instance still serves the user.

#### Description

While `forgetUser` runs on instance A, instance B does not know about it: B accepts the user's calls and
can write new data for the user during the erasure. Needs a shared tombstone in a repository.

Partly solved 2026-10-22 (D114): a call *already running* on B holds the thread's lease, and the erasure on A is then refused with a 409 (`data.busyThreadIds`) before any write. What remains: a call that *starts* on B during the erasure is still accepted — that is the shared tombstone.

#### Repro

Two gateway instances over the same repositories; start `deleteUserData(U)` on A; at the same time run `ask`
as U on B: B answers and stores turns and memory for U.

#### Found in

DDE-20324 Security checkup.

### [ ] (Medium) #INT1209 impr A tool's `execute` sees the resumer's context, not the asker's

#### Short

When another user resumes a paused run, the tool runs with the resumer's `userContext`.

#### Description

By design the approver executes (D32). A tool that needs the asker's context
(permissions, locale) cannot get it: the gateway keeps only the asker's `userId`. A fix may need `IRun` to store the
asker's context.

#### Repro

User A asks, a tool needs approval, user B approves via `resume`; inside `execute`, `userContext.userId` and
`permissions` are B's.

#### Found in

DDE-20324 Security checkup.

### [ ] (Medium) #INT1210 bug Concurrent writes of one user's memory lose facts

#### Short

`UserMemoryStore` does load → merge → `saveAll`; two writers at once overwrite each other.

#### Description

Two threads of the same user answering at once (or the UI and a memory job) each load the facts, merge
their own, and `saveAll` the whole list (`src/internal/user-memory-store/UserMemoryStore.ts`). The last writer wins and
the other's facts are gone. Data loss, not a security hole. Fix: per-fact `upsert` / `remove` on
`IUserMemoryRepository`, a change to the adapter contract.

#### Repro

User U, two threads; both `ask` at the same time with a message that yields a new fact each; after both memory
jobs, U's memory holds only one of the two facts.

#### Found in

DDE-20324 Security checkup.

### [ ] (Low) #INT1211 impr Production code imports `devConsole` from `src/dev-sandbox/`

#### Short

`KbRetriever` and `UserMemoryStore` import from the dev sandbox.

#### Description

`src/internal/kb-retriever/KbRetriever.ts` and `src/internal/user-memory-store/UserMemoryStore.ts`
import `devConsole` from `src/dev-sandbox/`. Off by default, so not a hole, but a layering smell: the shipped library
depends on a dev-only folder.

#### Repro

`grep -rln "dev-sandbox/utils/devConsole" src | grep -v "^src/dev-sandbox"` lists the two files.

#### Found in

DDE-20324 Security checkup.