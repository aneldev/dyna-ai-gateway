# Storage adapters

## About

Where the gateway keeps its data, and how an application puts that data in its own database. Not needed to use the
library: the getting-started pages run on the in-memory adapters the package ships.

## Description

Every store of the gateway takes a seam in its config: an `I…Repository` or an `I…Adapter` interface. A class that
implements one is a storage adapter; `IUsageAdapter` has the same shape but stores no data of the gateway. The store holds the
logic (validation, caching, the status rules); the adapter reads and writes, and keeps the contract its interface states
per method. Only its store calls it.

The package exports an in-memory implementation of every seam. They keep everything in the process and lose it at
restart: for tests, the sandbox and a first run, not for production.

## For whom is this chapter

A developer who puts the gateway on MongoDB, PostgreSQL, S3 or a vector database, or who writes the usage rules of the
application. A developer who changes how a part of the gateway behaves, not where it stores, replaces a class instead:
[Class replacement](30-class-replacement.md).

## How it works

- **One key per store, required.** The adapter is passed in the store's config: `config.threadStore.repository`,
  `config.fileStore.adapter`, … The key is required in every store's config; nothing is defaulted to memory.
- **The tenant is on every call that touches a tenant's data.** Those methods receive the `tenantId` on their arguments
  or on the record they save, and the adapter filters by it; `IBlobAdapter` gets it inside the key the `FileStore` builds.
  Tenant isolation rests on it. The model catalog and the prompt templates are global: their methods take no tenant.
- **The adapter chooses its tables.** A real adapter is constructed with the names of the collections or tables it uses,
  so the application decides between one set with a tenant column, a set per tenant, or a schema per tenant
  ([D28, D29](90-decisions.md#d28-d29-every-store-has-a-seam-and-the-names-of-its-tables-are-configuration)).
- **Three methods must be atomic.** `IThreadRepository.acquireLease` (one call at a time on a thread,
  [D77](90-decisions.md#d77-one-call-at-a-time-on-a-thread)) and `IRunRepository.transition` (a paused run is left once,
  [D69, D78](90-decisions.md#d69-d78-leaving-a-pause-is-one-atomic-step)) are check-and-set: one database operation with
  the condition in the filter, never a load followed by a save. `IPromptTemplateRepository.setActive` flips the active
  version in one transaction, so no reader sees two active versions or none.
- **Lists page by cursor.** `listThreads` and `listVersions` take a `page: IPageArgs` (`limit`, `startingAfter`,
  `endingBefore`; for `listVersions` the cursor is a version number,
  [D37](90-decisions.md#d37-lists-page-by-cursor)). `listThreads` is newest first by `createdAt`, the id breaking ties,
  without the deleted threads; `listVersions` is highest version first. A cursor that is not in the list is a 404 the
  adapter throws. `loadTurns` and the trace's `query` page by `skip` and `limit` instead.
- **A missing record is not an error, mostly.** A read by id (`loadThread`, `load`, a template's `get`) returns null, `IUserMemoryRepository.load` an empty list; a
  `remove` or `delete` of an unknown id does nothing. The exceptions throw a 404: `IBlobAdapter.get` and `signedUrl` for an
  unknown key, `setActive` for an unknown version. Each method's TypeDoc page states its full contract, the order of its
  results and what `anonymizeByUser` rewrites included.
- **Erasure reaches every storage adapter that holds the gateway's user data** ([D54](90-decisions.md#d54-forgetting-a-user-is-two-methods)); what the usage adapter stored is the application's to erase.
  `deleteUserData` and `anonymizeUserData` both remove the user's files (blob adapter) and facts (`deleteByUser`); then
  `deleteUserData` calls `delete` on the thread, run and trace repositories, `anonymizeUserData` calls `anonymizeByUser`
  on the same three.
- **Reads may be cached by the store.** The model catalog, the profiles and the prompt templates are cached per gateway
  instance (`cacheTtlMs`); another server instance sees a write once its cache runs out
  ([Live adjustment](50-live-adjustment-and-dependency-injection.md#3-live-adjustment)).

## How it can be extended

Write a class that implements the seam's interface and pass an instance in the store's config. The interface's TypeDoc
page lists every method and what the store expects of it.

```ts
import {
  InMemoryRunRepository,
  InMemoryTraceRepository,
  type IAIGatewayConfig,
  type IThreadRepository,
} from "dyna-ai-gateway";

declare const threadRepository: IThreadRepository; // the application's own adapter, over its database

const persistence: Pick<IAIGatewayConfig, "threadStore" | "runStore" | "trace"> = {
  threadStore: {repository: threadRepository},
  runStore: {repository: new InMemoryRunRepository()},
  trace: {repository: new InMemoryTraceRepository()},
};
```

Adapters can be mixed: one store on the application's database, the others in memory while they are not needed.

Packages for MongoDB, PostgreSQL and S3 are planned as packages of their own
([D120](90-decisions.md#d120-the-real-adapters-are-packages-of-their-own)); their status is in
[Known limits](10-architecture-and-trade-offs.md#6-known-limits).

## The ten seams

In the order an application needs them.

| Seam                                                                                   | Config key                       | What it keeps                                                                                                                  | Methods                                                                                                                                            | In memory                                                                                                                          |
|----------------------------------------------------------------------------------------|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| [`IModelRegistryRepository`](../30-api/index/interfaces/IModelRegistryRepository.md)   | `modelRegistry.repository`       | The models a profile may name, their caps and cost                                                                             | `loadAll`, `save`, `remove`                                                                                                                        | [`InMemoryModelRegistryRepository`](../30-api/index/classes/InMemoryModelRegistryRepository.md)                                    |
| [`IAIProfileRepository`](../30-api/index/interfaces/IAIProfileRepository.md)           | `aiProfileStore.repository`      | The profiles of each tenant                                                                                                    | `loadByTenant`, `save`, `remove`                                                                                                                   | [`InMemoryAIProfileRepository`](../30-api/index/classes/InMemoryAIProfileRepository.md)                                            |
| [`IThreadRepository`](../30-api/index/interfaces/IThreadRepository.md)                 | `threadStore.repository`         | Threads, their turns, the lease                                                                                                | `saveThread`, `loadThread`, `listThreads`, `appendTurn`, `loadTurns`, `listThreadIds`, `delete`, `anonymizeByUser`, `acquireLease`, `releaseLease` | [`InMemoryThreadRepository`](../30-api/index/classes/InMemoryThreadRepository.md)                                                  |
| [`IUsageAdapter`](../30-api/index/interfaces/IUsageAdapter.md)                         | `usageGuard.adapter`             | Not data of the gateway: the application's usage rules ([D121](90-decisions.md#d121-the-application-decides-every-model-call)) | `check` before every model call (a throw is a denial), `addUsage` once after every approved `check`, a failed call included                        | [`InMemoryUsageAdapter`](../30-api/index/classes/InMemoryUsageAdapter.md): approves every call unless its `deny` option refuses it |
| [`IRunRepository`](../30-api/index/interfaces/IRunRepository.md)                       | `runStore.repository`            | Every run, running, paused or finished: agents, human in the loop, recovery                                                    | `save`, `load`, `listByStatus`, `transition`, `delete`, `anonymizeByUser`                                                                          | [`InMemoryRunRepository`](../30-api/index/classes/InMemoryRunRepository.md)                                                        |
| [`IPromptTemplateRepository`](../30-api/index/interfaces/IPromptTemplateRepository.md) | `promptTemplateStore.repository` | The versioned prompt templates, global                                                                                         | `loadActive`, `get`, `listVersions`, `save`, `setActive`                                                                                           | [`InMemoryPromptTemplateRepository`](../30-api/index/classes/InMemoryPromptTemplateRepository.md)                                  |
| [`IBlobAdapter`](../30-api/index/interfaces/IBlobAdapter.md)                           | `fileStore.adapter`              | The bytes of the files of a question (images, PDFs)                                                                            | `put`, `get`, `signedUrl`, `remove`, `removeByPrefix`                                                                                              | [`InMemoryBlobAdapter`](../30-api/index/classes/InMemoryBlobAdapter.md)                                                            |
| [`IUserMemoryRepository`](../30-api/index/interfaces/IUserMemoryRepository.md)         | `userMemoryStore.repository`     | The user's facts, one record per tenant and user                                                                               | `load`, `saveAll`, `deleteByUser`                                                                                                                  | [`InMemoryUserMemoryRepository`](../30-api/index/classes/InMemoryUserMemoryRepository.md)                                          |
| [`IVectorIndexAdapter`](../30-api/index/interfaces/IVectorIndexAdapter.md)             | `vectorStore.adapter`            | The knowledge-base chunks and their embeddings                                                                                 | `upsert`, `deleteByDoc`, `search`, `moveBook`, `describe`                                                                                          | [`InMemoryVectorIndexAdapter`](../30-api/index/classes/InMemoryVectorIndexAdapter.md)                                              |
| [`ITraceRepository`](../30-api/index/interfaces/ITraceRepository.md)                   | `trace.repository`               | One entry per model call, for debugging and audit                                                                              | `save`, `load`, `query`, `delete`, `anonymizeByUser`                                                                                               | [`InMemoryTraceRepository`](../30-api/index/classes/InMemoryTraceRepository.md)                                                    |

## Summary

- Every store takes a storage adapter in its config; the key is required.
- The adapter stores; the store decides. Every call on a tenant's data carries the tenant.
- `acquireLease` and `transition` are check-and-set, `setActive` is one transaction.
- Each method's contract (order, null or 404, what it rewrites) is on the seam's TypeDoc page.
- The in-memory adapters are for tests and a first run.

## FAQ

**Can the stores share one database?** Yes. Each adapter is constructed with its own table or collection names; several
adapters can use one connection of the application.

**Do I have to replace all ten?** No. Each key takes any implementation of its seam; the in-memory ones stay where the
data does not need to survive a restart.

**Where do I enforce who may spend what?** In the `IUsageAdapter`: its `check` answers before every model call, and the
gateway holds no token logic of its own.

**Is a storage adapter the same as a replaced class?** No. A storage adapter changes where a store keeps its data; a
replaced class changes what the store does. See [Class replacement](30-class-replacement.md).
