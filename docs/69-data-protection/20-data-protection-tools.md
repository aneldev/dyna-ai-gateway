---
sidebar_label: Data protection tools
description: "Data protection tools of an AI gateway in TypeScript: export, correct, erase or anonymize a user's data, delete old conversations, control memory and traces."
keywords: [GDPR tools, right to erasure, data subject access request, anonymization, pseudonymisation, data retention, PII, LLM privacy, AI gateway, TypeScript]
---

# Data Protection Tools of the AI Gateway: Access, Erasure, Anonymization and Memory Controls

The gateway holds conversations, remembered facts, paused runs, files and a trace of every model call, all through the
application's repositories and adapters. This page shows the tools it gives to answer a data subject's request, to keep
less, and to keep sensitive data from the model, each with a sample. What each law requires is on
[GDPR, CCPA and HIPAA](10-gdpr-ccpa-hipaa.md); how to combine the tools into a process is on
[Best practices](30-data-protection-best-practices.md).

## The tools at a glance

| Tool                                                 | What it does                                                                 | Serves                                    |
|------------------------------------------------------|------------------------------------------------------------------------------|-------------------------------------------|
| `listThreads`, `getTurns`, `getThreadMemory`         | The user's threads, their turns and their thread memory                      | Access, portability                       |
| `getUserFacts`                                       | The facts remembered about the user                                          | Access                                    |
| `trace.query`                                        | The trace entries of a user, a thread, a kind or a period                    | Access, audit                             |
| `listPausedRuns`, `getPausedRun`                     | The user's paused runs; one run in full                                      | Access                                    |
| `upsertUserFact`, `removeUserFact`, `clearUserFacts` | Set, remove or clear the remembered facts                                    | Rectification, erasure of memory          |
| `resetThreadMemory`                                  | Clears the thread memory of a thread; the turns stay                         | Minimisation                              |
| `deleteUserData`                                     | Deletes the user's files, facts, threads, runs and trace entries in a tenant | Erasure, deletion                         |
| `anonymizeUserData`                                  | Removes what identifies the user, keeps counts and cost under a pseudonym    | Erasure where statistics must stay        |
| `delete`                                             | Deletes threads with their turns, files, runs and trace entries              | Retention, deletion of some conversations |
| `removeFilesByUser`, `deleteFile`                    | Deletes the user's files, or one file                                        | Deletion                                  |
| `kbIngestor.removeDocument`                          | Deletes a knowledge-base document's chunks                                   | Deletion of personal data in documents    |
| `workingMemory.enabled`, `userMemoryStore.enabled`   | The two memory switches, without a default                                   | Minimisation, by default                  |
| `userMemoryStore.rememberNeedsApproval`              | The model's remember tool asks the user first (default `true`)               | Minimisation, transparency                |
| An `ITraceRepository` of the application             | Decides what of a trace entry is stored                                      | Minimisation, storage limitation          |
| `guardrails.inputRules`                              | Blocks a prompt before the answering model sees it                           | Keeping PHI and special categories out    |
| `approvals`, `reviewAnswers` on a profile            | A person approves a tool call, or the answer before the user sees it         | Human intervention in automated decisions |

## Answer an access request

The read methods take the `IUserContext` of the person whose data is exported: they return only that user's threads,
facts and paused runs in that tenant. `trace.query` and `getPausedRun` take raw ids, so the application checks who may
call them.

```ts
import {
  AIGateway,
  EIssueSeverity,
  IAIGatewayConfig,
  IIssue,
  IInputRule,
  InMemoryTraceRepository,
  IPausedRunSummary,
  IThread,
  ITraceEntry,
  ITraceRepository,
  ITurn,
  IUserContext,
  IUserMemoryFact,
  IUserMemoryRepository,
  IWorkingMemoryState,
} from "dyna-ai-gateway";

declare const gateway: AIGateway; // your gateway

interface IUserDataExport {
  threads: { thread: IThread; turns: ITurn[]; memory: IWorkingMemoryState }[];
  facts: IUserMemoryFact[];
  traces: ITraceEntry[];
  pausedRuns: IPausedRunSummary[];
}

const exportUserData = async (userContext: IUserContext): Promise<IUserDataExport> => {
  const threads: IUserDataExport["threads"] = [];
  let endingBefore: string | null = null;
  let hasMore = true;
  while (hasMore) {
    const page = await gateway.listThreads({userContext, page: {limit: 200, startingAfter: null, endingBefore}});
    for (const thread of page.items) {
      const [turns, memory] = await Promise.all([
        gateway.getTurns({userContext, threadId: thread.id}),
        gateway.getThreadMemory({userContext, threadId: thread.id}),
      ]);
      threads.push({thread, turns, memory});
    }
    endingBefore = page.items[page.items.length - 1]?.id ?? null;
    hasMore = page.hasMore && endingBefore !== null;
  }

  const traces: ITraceEntry[] = [];
  for (let skip = 0; ; skip += 200) {
    const batch = await gateway.trace.query({
      tenantId: userContext.tenantId,
      filters: {userId: userContext.userId},
      skip,
      limit: 200,
    });
    traces.push(...batch);
    if (batch.length < 200) break;
  }

  return {
    threads,
    facts: await gateway.getUserFacts({userContext}),
    traces,
    pausedRuns: await gateway.listPausedRuns({userContext}),
  };
};
```

- A trace entry's request holds the system prompt, with the application's own instructions; the application decides what
  of it the person receives.
- `listPausedRuns` returns summaries without the system prompt or the messages; `getPausedRun` returns one run in full.
- The files are bytes in the application's `IBlobAdapter`, and the runs that ended are rows of its `IRunRepository`: the
  application reads them there.
- The usage records of `IUsageAdapter` are the application's own store.

## Correct or clear what is remembered

`upsertUserFact` sets a fact, `removeUserFact` removes one key, `clearUserFacts` removes all of them; the user's
threads stay. `resetThreadMemory` clears the thread memory of one thread and keeps its turns. What each method leaves
in place is in [Privacy and deletion](../20-learn-the-gateway/090-user-memory.md#27-privacy-and-deletion).

```ts
declare const userContext: IUserContext; // the person who asked

await gateway.upsertUserFact({userContext, key: "city", value: "Graz"}); // a correction
await gateway.removeUserFact({userContext, key: "employer"}); // one fact goes
```

## Erase a user

`deleteUserData({tenantId, userId})` deletes the user's files, facts, threads with their turns and thread memory, runs
and trace entries, and returns the counts in `IForgetUserResult`. It is a hard delete, per tenant, and a second call
returns zeros. While it runs, the user's new calls on this instance get a 409.

A call of the user still running on another instance makes it fail with status 409 and `data.busyThreadIds`, before
anything is erased. A memory update queued on another instance holds no lock and is not detected. With one instance, the
call alone is enough. With several, the application stops the user's traffic, lets every instance finish its calls and
background work before each attempt, and retries on a 409: the procedure is in
[Best practices, In code](30-data-protection-best-practices.md#in-code). What the erasure does not reach is in
[Data subject rights](10-gdpr-ccpa-hipaa.md#33-data-subject-rights).

## Anonymize instead of delete

`anonymizeUserData({tenantId, userId})` deletes the same files and facts, removes the turns, prompts, answers, system
prompts, thread titles and thread memory, cancels an open run, and keeps the threads, runs and trace entries as
skeletons (status, counts, usage, cost, dates) under one random pseudonym. The pseudonym is in the result, once.

```ts
const anonymized = await gateway.anonymizeUserData({tenantId: "acme", userId: "u-17"});
console.log(anonymized.threads, anonymized.traces); // the rows kept for the statistics
// anonymized.pseudonym ("@anon-…") links the rows to nobody unless it is stored next to the user's id
```

When the skeletons count as anonymous is a legal question:
[Anonymized or pseudonymised](10-gdpr-ccpa-hipaa.md#36-anonymized-or-pseudonymised).

## Delete conversations

`delete({tenantId, threadIds, userId?})` deletes the given threads, or `"all"` of the tenant or of one user, with their
turns, thread memory, files, runs and trace entries; the user's facts stay. A thread with a call running is skipped and
not counted. No store selects by age, so a retention job reads the old ids from the application's own thread database:

```ts
declare function findThreadIdsUpdatedBefore(args: { tenantId: string; before: Date }): Promise<string[]>; // your query

const deleteOldThreads = async ({tenantId, days}: { tenantId: string; days: number }): Promise<number> => {
  const threadIds = await findThreadIdsUpdatedBefore({tenantId, before: new Date(Date.now() - days * 86_400_000)});
  if (threadIds.length === 0) return 0;
  const {threads} = await gateway.delete({tenantId, threadIds});
  return threads; // a skipped busy thread is taken by the next run of the job
};
```

Trace entries without a thread (a knowledge-base ingestion, a system job) are deleted in the application's trace
repository.

## Decide what is remembered

Both memories are required switches of the config, without a default
([the switch](../20-learn-the-gateway/090-user-memory.md#21-the-switch)). With user memory on, a cheap model extracts
facts from the conversation in the background and stores them without asking; the model's remember tool asks the user
first unless `rememberNeedsApproval` is `false`.

```ts
declare const userMemoryRepository: IUserMemoryRepository; // your repository

const memory: Pick<IAIGatewayConfig, "workingMemory" | "userMemoryStore"> = {
  workingMemory: {enabled: true}, // the thread's own summary and notes
  userMemoryStore: {enabled: false, repository: userMemoryRepository, rememberNeedsApproval: true}, // nothing across threads
};
```

Off, the user memory makes no extraction calls; facts already stored are still read and editable.

## Keep content out of the trace

Every model call leaves a trace entry with the request as sent (system prompt and messages, files without their bytes)
and the result. A repository that must not keep them drops them in `save`; the ids, the model, the usage and the cost
stay for audit and cost reports.

```ts
class MetadataOnlyTraceRepository implements ITraceRepository {
  public constructor(private readonly inner: ITraceRepository) {
  }

  public save({entry}: { entry: ITraceEntry }): Promise<void> {
    const {request, result, ...metadata} = entry; // the prompt and the answer are not stored
    return this.inner.save({entry: metadata});
  }

  public load(args: Parameters<ITraceRepository["load"]>[0]): ReturnType<ITraceRepository["load"]> {
    return this.inner.load(args);
  }

  public query(args: Parameters<ITraceRepository["query"]>[0]): ReturnType<ITraceRepository["query"]> {
    return this.inner.query(args);
  }

  public delete(args: Parameters<ITraceRepository["delete"]>[0]): ReturnType<ITraceRepository["delete"]> {
    return this.inner.delete(args);
  }

  public anonymizeByUser(args: Parameters<ITraceRepository["anonymizeByUser"]>[0]): ReturnType<ITraceRepository["anonymizeByUser"]> {
    return this.inner.anonymizeByUser(args);
  }
}

const trace: IAIGatewayConfig["trace"] = {repository: new MetadataOnlyTraceRepository(new InMemoryTraceRepository())};
```

Without the request, a trace entry no longer shows why a model answered as it did; a repository can instead keep the
content for a short period and drop it later.

## Block sensitive data before the model

An input rule runs before the call of the answering model; an ERROR issue fails the call and the prompt is not stored as a turn. The
gateway has no built-in rule for personal data, and no rule removes text from a prompt: an application that must
redact does so before it calls the gateway.

```ts
const US_SSN = /\b\d{3}-\d{2}-\d{4}\b/;

const noSocialSecurityNumbers: IInputRule = {
  name: "no_ssn",
  check: async ({evidence}): Promise<IIssue[]> =>
    US_SSN.test(evidence.prompt)
      ? [{
        code: "ssn",
        message: "The prompt contains a US Social Security number",
        severity: EIssueSeverity.ERROR,
        field: "prompt",
        userMessage: "Please do not send Social Security numbers in the chat.",
      }]
      : [],
};

const guardrails: IAIGatewayConfig["guardrails"] = {inputRules: [noSocialSecurityNumbers]};
```

A rule that asks a model instead (a judge) sends the prompt to that model, and its trace entry holds it
([the judge](../20-learn-the-gateway/050-guardrails.md#25-the-judge)).

## A person in the decision

A profile's `approvals` lists the tools that wait for a person before they run; `reviewAnswers: true` holds every final
answer for a reviewer before the user sees it. Both pause the run and continue on `resume()`
([Human in the loop](../20-learn-the-gateway/040-human-in-the-loop.md#23-the-review-of-the-answer)).

## API reference

| Symbol                                                                                  | What it is                                  |
|-----------------------------------------------------------------------------------------|---------------------------------------------|
| [`AIGateway.deleteUserData`](../30-api/index/classes/AIGateway.md#deleteuserdata)       | Erasure of a user                           |
| [`AIGateway.anonymizeUserData`](../30-api/index/classes/AIGateway.md#anonymizeuserdata) | Erasure by pseudonymisation                 |
| [`AIGateway.delete`](../30-api/index/classes/AIGateway.md#delete)                       | Deletion of threads                         |
| [`AIGateway.listThreads`](../30-api/index/classes/AIGateway.md#listthreads)             | The user's threads                          |
| [`AIGateway.getTurns`](../30-api/index/classes/AIGateway.md#getturns)                   | The turns of a thread                       |
| [`AIGateway.getThreadMemory`](../30-api/index/classes/AIGateway.md#getthreadmemory)     | The thread memory of a thread               |
| [`AIGateway.getUserFacts`](../30-api/index/classes/AIGateway.md#getuserfacts)           | The user's facts                            |
| [`AIGateway.trace`](../30-api/index/classes/AIGateway.md#trace)                         | The trace, with `query`                     |
| [`AIGateway.listPausedRuns`](../30-api/index/classes/AIGateway.md#listpausedruns)       | The user's paused runs                      |
| [`IForgetUserResult`](../30-api/index/interfaces/IForgetUserResult.md)                  | The counts of an erasure and the pseudonym  |
| [`IDeleteArgs`](../30-api/index/interfaces/IDeleteArgs.md)                              | The arguments of `delete`                   |
| [`ITraceRepository`](../30-api/index/interfaces/ITraceRepository.md)                    | The trace's storage seam                    |
| [`IUserMemoryStoreConfig`](../30-api/index/interfaces/IUserMemoryStoreConfig.md)        | The user memory's switch, caps and approval |
| [`IInputRule`](../30-api/index/interfaces/IInputRule.md)                                | A rule on the prompt                        |
