# Remember the user

**This path is complete for its goal.** Its chapters, its examples and the pages it links are all you need; no other page
of the documentation is required. It starts from four pages of Getting started:
[What is the AI gateway](../10-getting-started/10-what-is-the-ai-gateway.md),
[Installation](../10-getting-started/20-installation.md), [Example: ask](../10-getting-started/30-example-ask.md),
[Example: run](../10-getting-started/40-example-run.md).

## 1. About

Two memories. The thread memory decides what of one conversation the model reads on each call. The user memory keeps
facts about the user, such as the language or the city, and puts them in every prompt of that user, across threads.

## 2. Description

For conversations longer than the model's context, and for assistants that should not ask the same thing twice. The
thread memory keeps a window of turns and, by default, a rolling summary. The user memory is filled in the background,
by the model through two built-in tools, and by your application. Both are data your screens can show and reset.

## 3. What you will be able to do

- Choose the strategy of a thread's memory: `SLIDING_WINDOW` or `SUMMARY_BUFFER`, per gateway or per profile. Examples: [8.0](#80-the-configuration), [8.1](#81-a-profile-keeps-the-exact-words-of-the-thread-without-a-summary).
- Show and reset "the memory of this chat". Example: [8.4](#84-the-memory-of-this-chat-panel-shows-and-resets-the-thread-memory).
- Let the model remember and forget user facts, with the user's approval. Example: [8.3](#83-the-user-asks-the-model-to-remember-a-fact-and-approves-it).
- Read, set and remove the facts from your application. Example: [8.5](#85-the-what-you-know-about-me-screen-reads-sets-and-removes-the-facts).
- Erase or pseudonymise a user on request. Example: [8.7](#87-a-users-data-is-erased-or-pseudonymised-on-request).

## 4. The parts

| # | Read                                                                                                                                | For                                             |
|---|-------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------|
| 1 | [Thread memory](../20-learn-the-gateway/080-thread-memory.md)                                                                       | the window, the summary, the strategies         |
| 2 | [User memory](../20-learn-the-gateway/090-user-memory.md)                                                                           | the facts, their writers, privacy               |
| 3 | [Models and profiles: Main model and cheap model](../20-learn-the-gateway/010-models-and-profiles.md#23-main-model-and-cheap-model) | the model the summary and the extraction run on |
| 4 | [Human in the loop: About](../20-learn-the-gateway/040-human-in-the-loop.md#1-about)                                                | the approval of `dyna_aigw_remember_user_fact`  |
| 5 | [Usage Guard: What a denial does](../20-learn-the-gateway/060-usage-guard.md#23-what-a-denial-does)                                 | a refused memory update is skipped              |

## 5. How the parts connect

1. On each call the thread memory returns the window and the notes; the user facts and the notes go into the `{memory}`
   slot as data ([The `{memory}` slot](../20-learn-the-gateway/080-thread-memory.md#26-the-memory-slot),
   [How the facts reach the prompt](../20-learn-the-gateway/090-user-memory.md#24-how-the-facts-reach-the-prompt)).
2. After an `ANSWER`, the summary and the fact extraction run in the background on the cheap model
   ([When the memory is updated](../20-learn-the-gateway/080-thread-memory.md#27-when-the-memory-is-updated),
   [The extraction](../20-learn-the-gateway/090-user-memory.md#22-the-extraction)).
3. In a `run()` the model writes facts through the built-in tools; remembering pauses for the user by default
   ([The two built-in tools](../20-learn-the-gateway/090-user-memory.md#23-the-two-built-in-tools)).
4. `whenIdle()` resolves when the background work is done
   ([D17](../60-architecture/90-decisions.md#d17-background-work-and-whenidle)).

## 6. API you should know

Grouped by the step of your code where you meet them, in the order of the examples.

### 6.1 Configure the memory

Examples: [8.0](#80-the-configuration), [8.1](#81-a-profile-keeps-the-exact-words-of-the-thread-without-a-summary).

| Symbol                                                                                                                                                                                 | What you use it for                          |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| [`IWorkingMemoryConfig`](../30-api/index/interfaces/IWorkingMemoryConfig.md)                                                                                                           | `enabled`, `strategy`                        |
| [`EWorkingMemoryStrategy`](../30-api/index/enumerations/EWorkingMemoryStrategy.md), [`TWorkingMemoryStrategy`](../30-api/index/type-aliases/TWorkingMemoryStrategy.md)                 | the strategy of a gateway or a profile       |
| [`IWorkingMemorySlidingWindow`](../30-api/index/interfaces/IWorkingMemorySlidingWindow.md), [`IWorkingMemorySummaryBuffer`](../30-api/index/interfaces/IWorkingMemorySummaryBuffer.md) | the options of each strategy                 |
| [`IUserMemoryStoreConfig`](../30-api/index/interfaces/IUserMemoryStoreConfig.md)                                                                                                       | `enabled`, the caps, `rememberNeedsApproval` |
| [`IThreadRepository`](../30-api/index/interfaces/IThreadRepository.md), [`IUserMemoryRepository`](../30-api/index/interfaces/IUserMemoryRepository.md)                                 | where threads and facts are kept             |

### 6.2 The memory of a thread

Examples: [8.4](#84-the-memory-of-this-chat-panel-shows-and-resets-the-thread-memory), [8.6](#86-a-test-waits-for-the-background-memory-update-before-reading-it).

| Symbol                                                                                                                                                                                                                                         | What you use it for             |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------|
| [`AIGateway.getThreadMemory`](../30-api/index/classes/AIGateway.md#getthreadmemory), [`resetThreadMemory`](../30-api/index/classes/AIGateway.md#resetthreadmemory), [`IWorkingMemoryState`](../30-api/index/interfaces/IWorkingMemoryState.md) | the "memory of this chat" panel |

### 6.3 The facts of a user

Examples: [8.5](#85-the-what-you-know-about-me-screen-reads-sets-and-removes-the-facts), [8.7](#87-a-users-data-is-erased-or-pseudonymised-on-request).

| Symbol                                                                                                                                                                                                                                                                                                   | What you use it for             |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------|
| [`IUserMemoryFact`](../30-api/index/interfaces/IUserMemoryFact.md)                                                                                                                                                                                                                                       | one fact                        |
| [`AIGateway.getUserFacts`](../30-api/index/classes/AIGateway.md#getuserfacts), [`upsertUserFact`](../30-api/index/classes/AIGateway.md#upsertuserfact), [`removeUserFact`](../30-api/index/classes/AIGateway.md#removeuserfact), [`clearUserFacts`](../30-api/index/classes/AIGateway.md#clearuserfacts) | the facts from your application |
| [`AIGateway.deleteUserData`](../30-api/index/classes/AIGateway.md#deleteuserdata), [`anonymizeUserData`](../30-api/index/classes/AIGateway.md#anonymizeuserdata)                                                                                                                                         | "forget this user"              |

### 6.4 Wait for the background work

Example: [8.6](#86-a-test-waits-for-the-background-memory-update-before-reading-it).

| Symbol                                                                | What you use it for              |
|-----------------------------------------------------------------------|----------------------------------|
| [`AIGateway.whenIdle`](../30-api/index/classes/AIGateway.md#whenidle) | waits for the background updates |

## 7. Advanced API

Grouped by the part of the gateway you replace.

### 7.1 The memory of a thread

| Symbol                                                           | Replace it when                                                                                                             |
|------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| [`IWorkingMemory`](../30-api/index/interfaces/IWorkingMemory.md) | the thread's window is built your way ([Your own memory](../20-learn-the-gateway/080-thread-memory.md#210-your-own-memory)) |
| [`IThreadStore`](../30-api/index/interfaces/IThreadStore.md)     | threads are stored your way; a repository is enough in most cases                                                           |

### 7.2 The facts of a user

| Symbol                                                               | Replace it when                           |
|----------------------------------------------------------------------|-------------------------------------------|
| [`IUserMemoryStore`](../30-api/index/interfaces/IUserMemoryStore.md) | the facts are kept and extracted your way |

### 7.3 Plugging your class in

| Symbol                                                                     | What it is                                                                                                         |
|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| [`IAIGatewayOverrides`](../30-api/index/interfaces/IAIGatewayOverrides.md) | the second argument of `AIGateway`; the keys of the parts above: `workingMemory`, `userMemoryStore`, `threadStore` |

## 8. Examples

The examples run on the `gateway` of 8.0 and the `userContext` of [Example: ask](../10-getting-started/30-example-ask.md). Names such as `invoices` or `ledger` stand for your application's code.

### 8.0 The configuration

The examples continue threads and keep facts about the user. The keys this path uses come first, each with why; the others are required by `IAIGatewayConfig` and keep the values of [Installation](../10-getting-started/20-installation.md), with the features this path does not need switched off. `gpt5Mini` and `textEmbedding3Small` are the models of Installation.

> **The bigger picture:** Your server builds this gateway once at startup. The memory settings here are the default of every profile; the facts of each user and the memory of each thread are kept in the two repositories.

```ts
import {
  AIGateway,
  IAIGatewayConfig,
  IAIProfile,
  EModelProvider,
  EWorkingMemoryStrategy,
  InMemoryAIProfileRepository,
  InMemoryBlobAdapter,
  InMemoryModelRegistryRepository,
  InMemoryPromptTemplateRepository,
  InMemoryRunRepository,
  InMemoryThreadRepository,
  InMemoryTraceRepository,
  InMemoryUsageAdapter,
  InMemoryUserMemoryRepository,
  InMemoryVectorIndexAdapter,
} from "dyna-ai-gateway";

const accounting: IAIProfile = {
  id: "accounting",
  tenantId: "acme",
  name: "Accounting assistant",
  modelId: "gpt-5-mini",
  promptAddendum: "You assist the accounting team of a Norwegian company. Amounts are in NOK.",
  allowedTools: [],
  approvals: [],
  limits: {maxStepsPerRun: 6, maxOutputTokens: 2_000},
};

const config: IAIGatewayConfig = {
  // What this path uses
  // the default of every profile; a profile may set its own (8.1)
  workingMemory: {enabled: true, strategy: {type: EWorkingMemoryStrategy.SUMMARY_BUFFER, recentTurns: 12}},
  threadStore: {repository: new InMemoryThreadRepository()}, // the turns and the memory state of each thread
  userMemoryStore: {
    repository: new InMemoryUserMemoryRepository(), // your IUserMemoryRepository in production
    enabled: true,                // the background extraction and the two built-in tools
    maxFacts: 20,                 // every fact is in every prompt of the user
    extractEveryTurns: 6,
    rememberNeedsApproval: true,  // dyna_aigw_remember_user_fact waits for the user (8.3)
  },
  defaultCheapModelId: "gpt-5-mini", // the summary and the extraction run on the cheap model
  runStore: {repository: new InMemoryRunRepository()}, // a remember request pauses the run until the user approves

  // Required by IAIGatewayConfig, nothing specific to this path: the in-memory stores of Installation,
  // and the features this path does not need switched off
  llmClient: {providers: {[EModelProvider.OPENAI]: {apiKey: process.env.OPENAI_API_KEY ?? ""}}},
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [gpt5Mini, textEmbedding3Small]})},
  aiProfileStore: {repository: new InMemoryAIProfileRepository({profiles: [accounting]})},
  promptTemplateStore: {repository: new InMemoryPromptTemplateRepository()},
  fileStore: {adapter: new InMemoryBlobAdapter(), path: "ai-files"},
  embedder: {embeddingModelId: "text-embedding-3-small", dimensions: 1536},
  vectorStore: {adapter: new InMemoryVectorIndexAdapter({embeddingModelId: "text-embedding-3-small", dimensions: 1536})},
  queryRewriter: {enabled: false}, // no follow-up rewrite
  humanGate: {userQuestions: {enabled: false}}, // the model asks no questions
  usageGuard: {adapter: new InMemoryUsageAdapter()},
  contextAssembler: {promptCaching: true, sharePromptCacheAcrossTenants: false},
  trace: {repository: new InMemoryTraceRepository()},
};

const gateway = new AIGateway(config);
```

### 8.1 A profile keeps the exact words of the thread, without a summary

The `workingMemory` of a profile replaces the gateway's strategy for the calls on that profile. `SLIDING_WINDOW` sends the newest turns that fit `chatHistoryRatio` of the history budget and writes no summary.

> **The bigger picture:** Set up next to the other profiles, at startup or in an admin screen: a code review needs the lines as they were written, while the accounting chat lives with a summary.

```ts
import {EWorkingMemoryStrategy, IAIProfile} from "dyna-ai-gateway";

const codeReview: IAIProfile = {
  id: "code-review",
  tenantId: "acme",
  name: "Code review",
  modelId: "gpt-5-mini",
  promptAddendum: "You review TypeScript code. Quote the lines you comment on.",
  allowedTools: [],
  approvals: [],
  limits: {maxStepsPerRun: 4, maxOutputTokens: 4_000},
  workingMemory: {type: EWorkingMemoryStrategy.SLIDING_WINDOW, chatHistoryRatio: 0.9}, // the exact words, no summary
};
await gateway.aiProfileStore.upsertProfile({tenantId: "acme", profile: codeReview});
```

### 8.2 The user continues a conversation on the same thread

The first `ask()` opens a thread; the second passes its `threadId` and the model reads the earlier turns. When the oldest turns no longer fit the model's window, they are left out and the answer carries the issue `turns_trimmed`.

> **The bigger picture:** The chat screen: every message after the first is sent with the thread the screen holds, and a long conversation tells the user when its start is out of sight.

```ts
import {EGatewayResponseKind} from "dyna-ai-gateway";

const first = await gateway.ask({
  userContext,
  profileId: "accounting",
  prompt: "Our VAT period is two months.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;
if (first.kind !== EGatewayResponseKind.ANSWER) throw new Error("No answer");

const later = await gateway.ask({
  userContext,
  profileId: "accounting",
  threadId: first.threadId,
  prompt: "When is the next filing due?",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (later.kind === EGatewayResponseKind.ANSWER && later.issues.some(issue => issue.code === "turns_trimmed")) {
  showToUser("The assistant no longer sees the start of this conversation.");
}
```

### 8.3 The user asks the model to remember a fact, and approves it

In a `run()`, the model saves a fact through the built-in tool `BUILT_IN_TOOL_NAMES.REMEMBER_USER_FACT`. With `rememberNeedsApproval: true` the run pauses on a `TOOL_APPROVAL` card first; the user's `resume()` with `APPROVE` writes the fact.

> **The bigger picture:** The user types "remember that …" in the chat and sees a small "Remember" / "Don't remember" card; from then on the fact is in every prompt of that user, in every thread.

```ts
import {BUILT_IN_TOOL_NAMES, EGatewayResponseKind, EPauseKind, EResumeAction} from "dyna-ai-gateway";

const paused = await gateway.run({
  userContext,
  profileId: "accounting",
  prompt: "Remember that I work from Vienna now.",
  kbFilters: {libraryIds: [], bookIds: []},
}).response;

if (paused.kind === EGatewayResponseKind.PAUSED) {
  const [card] = paused.envelopes;
  if (card.kind === EPauseKind.TOOL_APPROVAL && card.toolCall.toolName === BUILT_IN_TOOL_NAMES.REMEMBER_USER_FACT) {
    // Show {key: "location", value: "Vienna"} with "Remember" / "Don't remember"
    await gateway.resume({userContext, runId: card.runId, pauseId: paused.pauseId, decisions: [{action: EResumeAction.APPROVE}]}).response;
  }
}
```

### 8.4 The "memory of this chat" panel shows and resets the thread memory

`getThreadMemory` returns the summary and the facts the model keeps of one thread of the calling user; `resetThreadMemory` drops them and keeps the turns.

> **The bigger picture:** A side panel of the chat screen: the user sees what the assistant has kept of this conversation and clears it when it is wrong or out of date.

```ts
const memory = await gateway.getThreadMemory({userContext, threadId});
// {summary: "The user files VAT every two months …", facts: {vatPeriod: "two months"}, updatedAtTurn: 4}

await gateway.resetThreadMemory({userContext, threadId}); // the summary and the facts go, the turns stay
```

### 8.5 The "what you know about me" screen reads, sets and removes the facts

`getUserFacts` lists the facts of the calling user; `upsertUserFact`, `removeUserFact` and `clearUserFacts` change them from your application, without a model call.

> **The bigger picture:** The user's settings page, and your sign-up flow: the user reviews and deletes what the assistant knows, and your application sets the facts it already has.

```ts
const facts = await gateway.getUserFacts({userContext}); // [{key: "location", value: "Vienna", updatedAt: …}, …]

await gateway.upsertUserFact({userContext, key: "role", value: "Accountant"}); // set by the application, e.g. at sign-up
await gateway.removeUserFact({userContext, key: "location"});
await gateway.clearUserFacts({userContext}); // "forget everything about me"
```

### 8.6 A test waits for the background memory update before reading it

The summary and the facts are written in the background after the answer. `whenIdle()` resolves when that work is done, so a test reads the memory the call produced.

> **The bigger picture:** Your test suite or a script; a request handler of your server does not wait for the background work.

```ts
await gateway.ask({userContext, profileId: "accounting", threadId, prompt: "We moved to monthly VAT.", kbFilters: {libraryIds: [], bookIds: []}}).response;
await gateway.whenIdle(); // the memory is written in the background after the answer
const {summary, facts} = await gateway.getThreadMemory({userContext, threadId});
```

### 8.7 A user's data is erased or pseudonymised on request

`deleteUserData` removes the user's facts, files, threads, runs and trace entries and returns the counts. `anonymizeUserData` keeps the records under a pseudonym instead, for the usage and the cost the books must keep.

> **The bigger picture:** An admin job on a data-subject request (GDPR): it takes raw ids and checks no user, so your admin surface decides who may call it.

```ts
const erased = await gateway.deleteUserData({tenantId: "acme", userId: "u-17"}); // facts, files, threads, runs, trace
// or keep the records under a pseudonym:
await gateway.anonymizeUserData({tenantId: "acme", userId: "u-18"});
```

## 9. Pitfalls

- [Thread memory: Pitfalls](../20-learn-the-gateway/080-thread-memory.md#4-pitfalls)
- [User memory: Pitfalls](../20-learn-the-gateway/090-user-memory.md#4-pitfalls)
- A test that asserts on memory right after the answer reads it before the background update; await `whenIdle()` first
  ([D17](../60-architecture/90-decisions.md#d17-background-work-and-whenidle)).
- Deleting threads keeps the user's facts; "forget this user" is `deleteUserData` or `anonymizeUserData`
  ([How do I delete conversations?](../10-getting-started/90-faq.md#how-do-i-delete-conversations)).

## 10. Summary

- The thread memory gives every call a window and, under `SUMMARY_BUFFER`, notes; the profile can pick its strategy.
- User facts are `{key, value}` per user, in every prompt of the user, as data.
- Both are updated in the background after an answer, on the cheap model.
- Your application reads and edits both; erasure is `deleteUserData` or `anonymizeUserData`.

## 11. FAQ

- [How much of the conversation does the model see, and how do I choose?](../10-getting-started/90-faq.md#how-much-of-the-conversation-does-the-model-see-and-how-do-i-choose)
- [Thread memory: FAQ](../20-learn-the-gateway/080-thread-memory.md#6-faq)
- [User memory: FAQ](../20-learn-the-gateway/090-user-memory.md#6-faq)
