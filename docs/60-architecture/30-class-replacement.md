# Class replacement

## About

How an application replaces one of the classes the gateway is built from, and what the replacement must keep. Not needed
to use the library: the gateway builds all of its classes itself.

## Description

The gateway is composed of 24 classes, each behind an interface of its own (`IWorkingMemory`, `ILLMClient`, …). The second
argument of the constructor, `new AIGateway(config, overrides)`, takes one factory per class. Where a factory is given,
the gateway calls it instead of creating its own class, with the same config and the same dependencies it would have used.

## For whom is this chapter

A developer who changes how a part of the gateway behaves: another chunking of documents, a thread memory of the
application's own, an LLM client in front of a proxy, a scripted model in tests. A developer who only changes where the
gateway stores its data writes a [storage adapter](20-adapters.md) instead.

## How it works

- **A factory per class.** [`IAIGatewayOverrides`](../30-api/index/interfaces/IAIGatewayOverrides.md) has one optional
  member per class, each a [`TDepFactory`](../30-api/index/type-aliases/TDepFactory.md): `(config, deps) => instance`.
  The usual body is `(config, deps) => new MyClass(config, deps)`.
- **The same input as the gateway's own class.** `config` is the class's slice of `IAIGatewayConfig` (an optional slice
  arrives as `{}`); the tool registry's slice arrives with the built-in tools already in front of the application's.
  `deps` are the classes it uses, already built. A class without a config or without dependencies receives `undefined`
  there.
- **The whole interface.** The factory returns an object that implements the class's `I<Class>` interface. The package
  exports the gateway's classes as types only, none as a value, so a replacement cannot extend the default class
  or wrap it inside the factory: it implements every member itself.
- **One instance for everyone.** The gateway builds each class once, in dependency order, and passes the same instance to
  every class that depends on it. A replaced `llmClient` is the one the gateway's `ask`, `run` and `resume` call, and the
  guardrails' judge, the thread and user memory, the query rewriter and the embedder; the getters of the gateway (`gateway.trace`, `gateway.modelRegistry`, …) return the
  replacement too.
- **Fixed at construction.** The instances cannot be swapped on a running gateway; a new override means a new gateway
  ([Live adjustment](50-live-adjustment-and-dependency-injection.md#7-what-is-deliberately-not-possible)).

## How it can be extended

The 24 factories, by layer and in the order of [the classes](10-architecture-and-trade-offs.md#41-the-classes). Each
interface's page of the API reference states the contract the gateway relies on.

| Layer          | Factory               | Interface                                                                    | Replaced for                                                            |
|----------------|-----------------------|------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| Config         | `modelRegistry`       | [`IModelRegistry`](../30-api/index/interfaces/IModelRegistry.md)             | Models, caps and cost                                                   |
| Config         | `aiProfileStore`      | [`IAIProfileStore`](../30-api/index/interfaces/IAIProfileStore.md)           | The profiles of each tenant                                             |
| Config         | `promptTemplateStore` | [`IPromptTemplateStore`](../30-api/index/interfaces/IPromptTemplateStore.md) | The versioned templates                                                 |
| Context        | `contextAssembler`    | [`IContextAssembler`](../30-api/index/interfaces/IContextAssembler.md)       | How the system prompt and the history are assembled                     |
| Thread         | `threadStore`         | [`IThreadStore`](../30-api/index/interfaces/IThreadStore.md)                 | Threads, turns, the lease                                               |
| Thread         | `turnBuilder`         | [`ITurnBuilder`](../30-api/index/interfaces/ITurnBuilder.md)                 | Turns from a question and a model result, messages from stored turns    |
| Thread         | `fileStore`           | [`IFileStore`](../30-api/index/interfaces/IFileStore.md)                     | The files of a question                                                 |
| Memory         | `workingMemory`       | [`IWorkingMemory`](../30-api/index/interfaces/IWorkingMemory.md)             | The thread's history: sliding window, summary buffer, your own          |
| Memory         | `userMemoryStore`     | [`IUserMemoryStore`](../30-api/index/interfaces/IUserMemoryStore.md)         | The user's facts                                                        |
| Knowledge base | `kbIngestor`          | [`IKbIngestor`](../30-api/index/interfaces/IKbIngestor.md)                   | Chunk, embed and store a document                                       |
| Knowledge base | `mdChunker`           | [`IMdChunker`](../30-api/index/interfaces/IMdChunker.md)                     | How a Markdown document is split                                        |
| Knowledge base | `embedder`            | [`IEmbedder`](../30-api/index/interfaces/IEmbedder.md)                       | How chunks and queries are embedded                                     |
| Knowledge base | `vectorStore`         | [`IVectorStore`](../30-api/index/interfaces/IVectorStore.md)                 | Chunk storage and search                                                |
| Knowledge base | `queryRewriter`       | [`IQueryRewriter`](../30-api/index/interfaces/IQueryRewriter.md)             | The follow-up question rewritten before retrieval                       |
| Knowledge base | `kbRetriever`         | [`IKbRetriever`](../30-api/index/interfaces/IKbRetriever.md)                 | Which chunks reach the model                                            |
| Tools          | `toolRegistry`        | [`IToolRegistry`](../30-api/index/interfaces/IToolRegistry.md)               | The tools offered to the model                                          |
| Tools          | `toolPolicy`          | [`IToolPolicy`](../30-api/index/interfaces/IToolPolicy.md)                   | Which tools a run and a step get; allow, deny or hand a call to a human |
| Tools          | `skillRegistry`       | [`ISkillRegistry`](../30-api/index/interfaces/ISkillRegistry.md)             | The skills offered and loaded on demand                                 |
| Control        | `humanGate`           | [`IHumanGate`](../30-api/index/interfaces/IHumanGate.md)                     | Pause, resume and expiry of approvals and questions                     |
| Control        | `runStore`            | [`IRunStore`](../30-api/index/interfaces/IRunStore.md)                       | The runs that paused, and their status afterwards                       |
| Control        | `usageGuard`          | [`IUsageGuard`](../30-api/index/interfaces/IUsageGuard.md)                   | The check before and the report after every model call                  |
| Control        | `guardrails`          | [`IGuardrails`](../30-api/index/interfaces/IGuardrails.md)                   | The rules on input and output                                           |
| Execution      | `llmClient`           | [`ILLMClient`](../30-api/index/interfaces/ILLMClient.md)                     | Another SDK, a proxy, a scripted model in tests                         |
| Ops            | `trace`               | [`ITrace`](../30-api/index/interfaces/ITrace.md)                             | One entry per model call                                                |

A replaced Markdown splitter, with the application's own splitting function:

```ts
import {
  AIGateway,
  type IAIGatewayConfig,
  type IChunk,
  type IKbDocument,
  type IMdChunker,
  type IMdChunkerConfig,
} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig;
declare const splitByHeadings: (doc: IKbDocument, maxTokens: number) => IChunk[]; // the application's own splitter

class HeadingChunker implements IMdChunker {
  constructor(private readonly config: IMdChunkerConfig) {}

  public chunk({doc}: {doc: IKbDocument}): IChunk[] {
    return splitByHeadings(doc, this.config.maxTokens ?? 800);
  }

  public countTokens({text}: {text: string}): number {
    return Math.ceil(text.length / 4);
  }
}

const gateway = new AIGateway(config, {
  mdChunker: (chunkerConfig) => new HeadingChunker(chunkerConfig),
});
```

## Storage adapter or class replacement

| The application wants to                                                 | Use                                            |
|--------------------------------------------------------------------------|------------------------------------------------|
| Keep threads, runs, files or chunks in its own database                  | A [storage adapter](20-adapters.md)            |
| Decide who may spend what                                                | The usage adapter, `config.usageGuard.adapter` |
| Change what a part of the gateway does (split, remember, assemble, call) | A class replacement                            |
| Run the gateway in tests without a provider                              | A replaced `llmClient`                         |

## Summary

- `overrides` takes one factory per class; the factory gets the class's config and dependencies.
- The replacement implements the whole `I<Class>` interface: the default class cannot be extended.
- One instance serves every class that depends on it, for the life of the gateway.

## FAQ

**Can I wrap the gateway's own class and change one method?** No. No class is exported as a value; a replacement
implements the interface from scratch.

**What must a replaced `llmClient` do besides calling the model?** Everything `ILLMClient` states: `complete` for one
answer, `run` for the agent loop (the tool calls through the gateway's hooks, the pause, the step limit, the abort) and
`embed` for the embeddings. Around each model call it asks the `usageGuard` first, reports the usage after it and
writes the trace entry; a client that skips them leaves calls unaccounted and untraced. The contract is on the [`ILLMClient`](../30-api/index/interfaces/ILLMClient.md)
page.

**Can I replace a class for one call only?** No. Per-call behaviour comes from the call's input (`profileId`,
`activeTools`, `instructions`, …); the classes are fixed when the gateway is constructed.
