---
description: One AI gateway for many customers. Each call carries a tenant id, and profiles, threads, files, memory, knowledge base and trace are kept per tenant. A single-tenant application passes an empty tenant id.
keywords: [multi-tenant, tenant isolation, single-tenant, tenantId, SaaS, AI gateway]
---

# Tenants

A tenant is the customer whose data is kept apart from every other customer's. One gateway instance serves every
tenant: each call on a tenant's data names its tenant, and every per-tenant store reads and writes under it. A SaaS
application runs one gateway for all its customers, not one per customer.

:::tip[Optional]

Tenants are optional. An application without tenants skips this page and passes `tenantId: ""` wherever the code asks
for a tenant id ([Tenants are optional](../10-getting-started/25-tenants-are-optional.md)). Once it writes its own
repository or blob adapter, [2.4](#24-a-single-tenant-application) and the last two pitfalls concern it.

:::

## 1. About

| Piece                                                                 | What it is                                                              | Who provides it                     |
|-----------------------------------------------------------------------|-------------------------------------------------------------------------|-------------------------------------|
| [`IUserContext.tenantId`](../30-api/index/interfaces/IUserContext.md) | the tenant of every user call ([2.1](#21-where-the-tenant-comes-from))  | the application, on every call      |
| `tenantId` argument                                                   | the tenant of every admin call ([2.1](#21-where-the-tenant-comes-from)) | the application's back office       |
| [`IAIProfile.tenantId`](../30-api/index/interfaces/IAIProfile.md)     | the tenant a profile belongs to                                         | the application, at `upsertProfile` |

A tenant id is a plain `string`. The gateway does not create or list tenants: a tenant exists when the application uses
its id. The one check is in the file store, which uses the id as a folder name: a tenant id with `/` or `\`, or that is
`.` or `..`, is a 400 there ([Chat files](092-chat-files.md#21-upload)).

## 2. Logic

### 2.1 Where the tenant comes from

The gateway sees no session or token. The application authenticates the user and sets `tenantId` from its own session,
never from the request body: the gateway trusts the tenant the application sets
([D118](../60-architecture/90-decisions.md#d118-the-gateway-checks-what-a-user-could-forge-and-trusts-what-the-application-sets)).

| Kind of call | Takes         | Methods                                                                                                                                                                                                                                                                                                        |
|--------------|---------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| user         | `userContext` | `ask`, `run`, `resume`, `cancelRun`, `toolRegistry.execute`, `toolRegistry.reportFailure`, `uploadFile`, `deleteFile`, `getFileUrl`, `listThreads`, `getTurns`, `renameThread`, `getUserFacts`, `upsertUserFact`, `removeUserFact`, `clearUserFacts`, `getThreadMemory`, `resetThreadMemory`, `listPausedRuns` |
| admin        | `tenantId`    | `delete`, `deleteUserData`, `anonymizeUserData`, `removeFilesByUser`, `expirePausedRuns`, `recoverStuckRuns`, `getPausedRun`; `aiProfileStore.*`, `kbIngestor.*`, `trace.*` (`record` reads it from the entry), `usageGuard.check`, `usageGuard.addUsage` (in their arguments)                                 |
| global       | no tenant     | `modelRegistry.*`, `promptTemplateStore.*`, `toolRegistry.get`, `toolRegistry.list`, `whenIdle`, `shutdown`                                                                                                                                                                                                    |

The admin methods are for the application's back office, not for a route the end user can reach with a tenant id of
their choice.

### 2.2 What is kept per tenant, and what is shared

| Data                    | Scope                | Repository                                                                             |
|-------------------------|----------------------|----------------------------------------------------------------------------------------|
| profiles                | per tenant           | [`IAIProfileRepository`](../30-api/index/interfaces/IAIProfileRepository.md)           |
| threads and turns       | per tenant, per user | [`IThreadRepository`](../30-api/index/interfaces/IThreadRepository.md)                 |
| runs (running, paused)  | per tenant           | [`IRunRepository`](../30-api/index/interfaces/IRunRepository.md)                       |
| files                   | per tenant, per user | [`IBlobAdapter`](../30-api/index/interfaces/IBlobAdapter.md), by the key               |
| user facts              | per tenant, per user | [`IUserMemoryRepository`](../30-api/index/interfaces/IUserMemoryRepository.md)         |
| knowledge-base chunks   | per tenant           | [`IVectorIndexAdapter`](../30-api/index/interfaces/IVectorIndexAdapter.md)             |
| trace entries           | per tenant           | [`ITraceRepository`](../30-api/index/interfaces/ITraceRepository.md)                   |
| usage                   | the application's    | [`IUsageAdapter`](../30-api/index/interfaces/IUsageAdapter.md) gets `tenantId`         |
| models                  | shared               | [`IModelRegistryRepository`](../30-api/index/interfaces/IModelRegistryRepository.md)   |
| system prompt templates | shared               | [`IPromptTemplateRepository`](../30-api/index/interfaces/IPromptTemplateRepository.md) |
| tools                   | shared               | `toolRegistry` in the config                                                           |

How a repository receives the tenant is in [Adapters](../60-architecture/20-adapters.md). The gateway knows no default and no shared profile: each tenant gets its own profiles through `aiProfileStore.upsertProfile`, and a
call that names a profile its tenant does not have is a 404
([D103](../60-architecture/90-decisions.md#d103-a-call-always-names-its-profile)). A tenant's own wording goes into its
profile's `promptAddendum`; the template stays shared
([System prompt layers](../60-architecture/40-system-prompt-production-layers.md#which-layer-to-use)).

### 2.3 How tenants are kept apart

| Case                                                        | Result                                                 |
|-------------------------------------------------------------|--------------------------------------------------------|
| a thread, run, profile or trace id of another tenant        | 404, as an id that does not exist                      |
| a thread id of another tenant in `delete` or `trace.delete` | ignored: nothing is removed or counted                 |
| a file pointer of another tenant on `ask` or `run`          | 400                                                    |
| a knowledge-base search                                     | the adapter filters by `tenantId`                      |
| the prompt cache                                            | per tenant with `sharePromptCacheAcrossTenants: false` |

A vector index shared by the tenants holds every tenant's chunks: an `IVectorIndexAdapter` that drops the `tenantId` filter of `search`
returns another tenant's chunks, and the gateway cannot tell
([Multi-tenant RAG](../50-ai-best-practices/080-multi-tenant-rag.md)). The prompt-cache scope is described in
[System prompt layers](../60-architecture/40-system-prompt-production-layers.md#the-layers-in-the-order-the-model-reads-them).

### 2.4 A single-tenant application

An application with one customer passes `tenantId: ""` on every call and on every profile. `""` is a valid tenant
like any other: the stores keep it apart from the tenants with an id, and the erasure methods remove its data
([D130](../60-architecture/90-decisions.md#d130-an-empty-tenant-id-is-a-tenant-like-any-other)); the code is in
[Tenants are optional](../10-getting-started/25-tenants-are-optional.md). A file of the empty
tenant is stored at `/<path>/<userId>/<fileId>` ([Chat files](092-chat-files.md#21-upload)).

A repository or blob adapter the application writes must accept the empty tenant
([Adapters](../60-architecture/20-adapters.md)).

### 2.5 Maintenance per tenant

`delete`, `expirePausedRuns` and `recoverStuckRuns` work on one tenant per call. A job that runs them for every tenant
loops over the tenant ids the application knows
([What happens to the runs a crashed server left behind?](../10-getting-started/90-faq.md#what-happens-to-the-runs-a-crashed-server-left-behind)). The gateway has no method that lists tenants or removes a whole
tenant.

## 3. Examples

The examples reuse the `gateway` of [Installation](../10-getting-started/20-installation.md) and its
`accountingProfile`.

### 3.1 The user context from the session

```ts
import {IUserContext} from "dyna-ai-gateway";

declare const session: {customerId: string; userId: string; roles: string[]; locale: string; timezone: string};

const userContext: IUserContext = {
  tenantId: session.customerId, // from the authenticated session, never from the request body
  userId: session.userId,
  permissions: session.roles,
  locale: session.locale,
  timezone: session.timezone,
  now: new Date(),
};
```

### 3.2 Onboard a tenant

A new customer gets its profiles. The model and the tools are shared; the profile names which of them the tenant uses.

```ts
await gateway.aiProfileStore.upsertProfile({
  tenantId: "globex",
  profile: {...accountingProfile, tenantId: "globex", promptAddendum: "You are the assistant of Globex."},
});
```

### 3.3 Offboard a tenant

No single call removes a tenant. The application removes its threads, then each user's remaining data, its documents
and profiles, and last the trace entries outside threads (the embedding calls of the knowledge base have none).

```ts
declare const userIds: string[]; // the tenant's users, from the application
declare const docIds: string[];  // the tenant's knowledge-base documents, from the application

const tenantId = "globex";
const {threads} = await gateway.delete({tenantId, threadIds: "all"}); // a thread with a call in flight is skipped
console.log(`${threads} threads deleted`);
for (const userId of userIds) await gateway.deleteUserData({tenantId, userId});
for (const docId of docIds) await gateway.kbIngestor.removeDocument({tenantId, docId});
for (const profile of await gateway.aiProfileStore.listProfiles({tenantId})) {
  await gateway.aiProfileStore.removeProfile({tenantId, profileId: profile.id});
}
await gateway.trace.delete({tenantId, threadIds: "all"}); // every entry of the tenant, with or without a thread
```

`delete` skips a thread with a call in flight; `deleteUserData` waits for the user's calls on this instance and is a 409
while a call of the user runs on another instance. Run the job when the tenant has no calls, and again after a 409. What
each method removes is in
[Data protection tools](../69-data-protection/20-data-protection-tools.md).

## 4. Pitfalls

- **The tenant from the request.** A `tenantId` read from the request body or a URL lets a user read another tenant's
  threads. Set it from the authenticated session.
- **An admin method behind a user route.** `deleteUserData`, `getPausedRun` and `trace.query` take a bare `tenantId`
  and check no user. Call them from the back office only.
- **A vector adapter without the tenant filter.** The search returns every tenant's chunks; the gateway does not see it.
- **A shared prompt cache by accident.** `sharePromptCacheAcrossTenants: true` lets one tenant's call read another
  tenant's cache entry of the same stable block. Keep it `false` unless every tenant runs the same profile text.
- **A repository that refuses `""`.** A single-tenant application then fails at its first call to that repository. Accept the empty
  string as a tenant id.
- **A blob adapter that trims the leading `/`.** The empty tenant's user `acme` then shares the folder `acme/` with the
  tenant `acme` when `path` is empty. Store the key unchanged.

## 5. Summary

- Every call on a tenant's data names its tenant: `userContext.tenantId` for a user, `tenantId` for the back office.
- Profiles, threads, runs, files, user facts, knowledge base and trace are per tenant; models, templates and tools are
  shared.
- An id of another tenant reads as an id that does not exist; a file pointer of another tenant is a 400.
- A single-tenant application passes `tenantId: ""`.

## 6. FAQ

**Do I need tenants if my application has one customer?**
No. Pass `tenantId: ""` everywhere ([2.4](#24-a-single-tenant-application)).

**Can two tenants share a profile?**
No. Each tenant holds its own copy; upsert the same profile under each tenant id ([3.2](#32-onboard-a-tenant)).

**Can a tenant have its own models?**
The model catalog is shared. A tenant uses the models its profiles name.

**Does the gateway enforce a per-tenant budget?**
No. The `IUsageAdapter` gets the `tenantId` of every model call and decides
([Token control with the Usage Guard](060-usage-guard.md)).

## 7. API reference

| Symbol                                                                                | What it is                                       |
|---------------------------------------------------------------------------------------|--------------------------------------------------|
| [`IUserContext`](../30-api/index/interfaces/IUserContext.md)                          | the caller, `tenantId` among its fields          |
| [`IAIProfile`](../30-api/index/interfaces/IAIProfile.md)                              | a profile, owned by one tenant                   |
| [`AIGateway.delete`](../30-api/index/classes/AIGateway.md#delete)                     | removes threads of a tenant                      |
| [`AIGateway.deleteUserData`](../30-api/index/classes/AIGateway.md#deleteuserdata)     | erases a user of a tenant                        |
| [`AIGateway.expirePausedRuns`](../30-api/index/classes/AIGateway.md#expirepausedruns) | expires the paused runs of a tenant              |
| [`AIGateway.recoverStuckRuns`](../30-api/index/classes/AIGateway.md#recoverstuckruns) | recovers the stuck runs of a tenant              |
| [`IAIProfileStore`](../30-api/index/interfaces/IAIProfileStore.md)                    | `upsertProfile`, `listProfiles`, `removeProfile` |
| [`IKbIngestor`](../30-api/index/interfaces/IKbIngestor.md)                            | the knowledge base of a tenant                   |
| [`IUsageAdapter`](../30-api/index/interfaces/IUsageAdapter.md)                        | gets the tenant of every model call              |
| [`IContextAssemblerConfig`](../30-api/index/interfaces/IContextAssemblerConfig.md)    | `sharePromptCacheAcrossTenants`                  |
