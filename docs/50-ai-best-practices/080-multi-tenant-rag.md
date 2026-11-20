---
sidebar_label: Multi-tenant RAG
description: "Multi-tenant RAG in TypeScript: every knowledge-base search scoped to the caller's tenant, the libraries of each call computed from the user's access rights, an empty scope that searches nothing, and tools scoped by the caller, not by the model."
keywords: [multi-tenant RAG, RAG access control, document permissions, vector search isolation, SaaS AI, data isolation, TypeScript]
---

# Multi-Tenant RAG: Keep Every Customer's Documents Out of Every Other Customer's Answers

In a SaaS product, one index often holds the documents of every customer, and inside a customer, documents that only some
users may read. A retrieval that ignores either boundary puts another company's contract or the HR handbook into an
answer. The practice is to isolate the tenant in every search and write, and to compute the scope of each call from the
user's rights, in your code, on every call.

## 1. The problem

- A vector search returns the nearest chunks of the whole index unless something filters it.
- A scope stored on the conversation outlives a change of the user's rights.
- A default of "search everything" turns a missing permission into a leak.
- A tool that takes the tenant or the customer id from the model's input lets an injected prompt name another one.

## 2. The practice

1. **The tenant is never a parameter of the model.** Every knowledge-base search carries the `tenantId` of the
   caller's `userContext`, and the vector store refuses to write a record of another tenant. The filter itself is your
   vector index adapter's database query: the gateway does not check the hits again, so an adapter that drops it
   leaks.
2. **The scope comes from your access rules, on every call.** `kbFilters` names the libraries, books, tags and language of
   this call. Compute it from what the user may read, at the moment of the call. A thread does not keep it; a paused
   run does: it resumes with the excerpts of its first step, without a new search, so the answer of a `resume()` rests on the
   asker's scope at the start, whoever resumes it.
3. **Empty means nothing.** `libraryIds: []` searches nothing; every library is `"all"`, written out. A permission list
   that came out empty by accident therefore leaks nothing.
4. **Never `"all"` as a default.** `"all"` is every library of the tenant. Use it only for users who may read all of them.
5. **Tools scope by the caller.** A tool reads the tenant and the user from the `userContext` it receives, never from the
   model's input.
6. **The prompt cache follows the same boundary.** With `sharePromptCacheAcrossTenants: false`, each tenant writes and
   reads its own cache entries ([Prompt caching](110-prompt-caching.md)).

## 3. In code

The samples run on your `gateway` and the caller's `userContext`. The setup they need is in the learning path
[Answer from your documents](../24-learning-paths/060-answer-from-your-documents.md).

The scope of a call, from your access rules:

```ts
import {AIGateway, IChunkFilters, IUserContext} from "dyna-ai-gateway";

declare const gateway: AIGateway;        // your gateway, with a knowledge base
declare const userContext: IUserContext; // tenantId and userId from your authentication
declare const access: {readableLibraries(tenantId: string, userId: string): Promise<string[]>}; // your access rules

const scopeFor = async (user: IUserContext): Promise<IChunkFilters> => ({
  libraryIds: await access.readableLibraries(user.tenantId, user.userId), // [] searches nothing
  bookIds: [], // every book of those libraries
});

const {response} = gateway.ask({
  userContext,
  profileId: "support",
  prompt: "What is the notice period in our framework contract?",
  kbFilters: await scopeFor(userContext), // computed on every call, never stored on the thread
});
```

Ingestion names the tenant from your server's context, never from user input:

```ts
import {IKbDocument} from "dyna-ai-gateway";

declare const doc: IKbDocument; // libraryId, bookId, tags, language: set by your document editor

await gateway.kbIngestor.ingestDocument({tenantId: userContext.tenantId, doc, userId: userContext.userId});
```

A tool reads the tenant from the caller:

```ts
import {z} from "zod";
import {defineTool} from "dyna-ai-gateway";

declare const contracts: {find(args: {tenantId: string; contractNo: string}): Promise<{contractNo: string; endsAt: string} | null>};

const getContract = defineTool({
  name: "get_contract",
  description: "Returns one contract of the customer by its number: contractNo, endsAt.",
  inputSchema: z.object({contractNo: z.string()}), // no tenant in the input: the model cannot name one
  tags: ["contracts", "read"],
  execute: async ({input: {contractNo}, userContext: caller}) => contracts.find({tenantId: caller.tenantId, contractNo}),
});
```

## 4. Pitfalls

- **`"all"` as the default scope.** The gateway does not know who may read a library. A scope wider than the user's
  rights puts documents they may not see into the prompt.
- **`bookIds` without their library.** Books narrow libraries. `{libraryIds: [], bookIds: ["vat-2026"]}` searches nothing.
- **A custom vector adapter that drops the tenant filter.** The adapter's `search` receives the `tenantId`; every query
  of your database filters by it.
- **The scope cached on the session.** A revoked permission keeps working until the session ends. Compute it per call.
- **Tenant ids in tool inputs.** A field the model fills is a field an injected prompt can fill.

## 5. Checklist

- [ ] `userContext.tenantId` comes from your authentication, never from the request body.
- [ ] `kbFilters` is computed from the user's rights on every call.
- [ ] No code path defaults to `libraryIds: "all"`.
- [ ] Your vector index adapter filters every query by `tenantId`.
- [ ] Tools read the tenant and the user from `userContext`.

## 6. Go further

- [Add a knowledge base to the LLM](../20-learn-the-gateway/070-knowledge-base.md#23-the-scope-of-a-call-kbfilters): the
  fields of `kbFilters`, the application's vector index.
- [Who may read a thread, a file or a paused run?](../10-getting-started/90-faq.md#who-may-read-a-thread-a-file-or-a-paused-run)
- [Stop hallucinations](020-stop-llm-hallucinations.md): grounded answers from the scope.
