import {ZodType} from "zod";

import {
  IFileRef,
  IIssue,
  ISkill,
  IToolDef,
  IUsage,
  IUserContext,
  EOutputFormat,
  TThreadIds,
} from "./contracts";
import {
  IModelRegistry,
  IModelRegistryConfig,
} from "./internal/model-registry";
import {
  IAIProfileStore,
  IAIProfileStoreConfig,
  IAIProfileStoreDeps,
} from "./internal/ai-profile-store";
import {
  IPromptTemplateStore,
  IPromptTemplateStoreConfig,
} from "./internal/prompt-template-store";
import {
  IThreadStore,
  IThreadStoreConfig,
} from "./internal/thread-store";
import {ITurnBuilder} from "./internal/turn-builder";
import {
  IFileStore,
  IFileStoreConfig,
} from "./internal/file-store";
import {
  IWorkingMemory,
  IWorkingMemoryConfig,
  IWorkingMemoryDeps,
} from "./internal/working-memory";
import {
  IUserMemoryStore,
  IUserMemoryStoreConfig,
  IUserMemoryStoreDeps,
} from "./internal/user-memory-store";
import {
  IMdChunker,
  IMdChunkerConfig,
} from "./internal/md-chunker";
import {
  IEmbedder,
  IEmbedderConfig,
  IEmbedderDeps,
} from "./internal/embedder";
import {
  IChunkFilters,
  IVectorStore,
  IVectorStoreConfig,
} from "./internal/vector-store";
import {
  IQueryRewriter,
  IQueryRewriterConfig,
  IQueryRewriterDeps,
} from "./internal/query-rewriter";
import {
  IKbRetriever,
  IKbRetrieverConfig,
  IKbRetrieverDeps,
} from "./internal/kb-retriever";
import {
  IToolRegistry,
  IToolRegistryConfig,
} from "./internal/tool-registry";
import {
  IToolPolicy,
  IToolPolicyConfig,
} from "./internal/tool-policy";
import {
  ISkillRegistry,
  ISkillRegistryConfig,
} from "./internal/skill-registry";
import {
  IRun,
  IRunStore,
  IRunStoreConfig,
} from "./internal/run-store";
import {
  IHumanGate,
  IHumanGateConfig,
  IHumanGateDeps,
  TPauseEnvelopes,
} from "./internal/human-gate";
import {
  IUsageGuard,
  IUsageGuardConfig,
} from "./internal/usage-guard";
import {
  IGuardrails,
  IGuardrailsConfig,
  IGuardrailsDeps,
} from "./internal/guardrails";
import {
  ILLMClient,
  ILLMClientConfig,
  ILLMClientDeps,
  ILLMClientEvent,
  IMessage,
} from "./internal/llm-client";
import {
  IContextAssembler,
  IContextAssemblerConfig,
  IContextAssemblerDeps,
} from "./internal/context-assembler";
import {
  ITrace,
  ITraceConfig,
} from "./internal/trace";
import {
  IKbIngestor,
  IKbIngestorConfig,
  IKbIngestorDeps,
} from "./internal/kb-ingestor";

/**
 * Everything the gateway needs: one config per child, settings and persistence seams only. No class instance is in it;
 * the gateway creates and injects its children itself.
 *
 * Written by the host application and passed to the `AIGateway` constructor; `createGatewayDeps` hands each member to the
 * child of the same name. A member that is optional has a runtime default of `{}`: the child runs with its own defaults.
 */
export interface IAIGatewayConfig {
  /** The models a profile may name, with their caps and prices: the repository of the `ModelRegistry`. */
  modelRegistry: IModelRegistryConfig;
  /** Where the profiles live: the repository of the `AIProfileStore`. */
  aiProfileStore: IAIProfileStoreConfig;
  /** Where the prompt templates live, and the templates seeded on the first run: the `PromptTemplateStore`. */
  promptTemplateStore: IPromptTemplateStoreConfig;
  /** Where threads and turns live, and how long a call's lease on a thread holds: the `ThreadStore`. */
  threadStore: IThreadStoreConfig;
  /** Where uploaded files live, the allowed MIME types and the size cap: the `FileStore`. */
  fileStore: IFileStoreConfig;
  /** The thread memory: its switch and its strategy (`WorkingMemory`). */
  workingMemory: IWorkingMemoryConfig;
  /** The user memory: its switch, its repository, the caps of the facts and the extraction cadence (`UserMemoryStore`). */
  userMemoryStore: IUserMemoryStoreConfig;
  /**
   * How a Markdown document is cut into chunks (`MdChunker`): the token bounds of a chunk and the overlap.
   *
   * @default {}
   */
  mdChunker?: IMdChunkerConfig;
  /** The embedding model, its dimensions and the batch size (`Embedder`). */
  embedder: IEmbedderConfig;
  /** Where the chunks and their vectors live (`VectorStore`). */
  vectorStore: IVectorStoreConfig;
  /** Whether a question is rewritten before the knowledge-base search (`QueryRewriter`). */
  queryRewriter: IQueryRewriterConfig;
  /**
   * How many chunks a knowledge-base search returns and the minimum score (`KbRetriever`).
   *
   * @default {}
   */
  kbRetriever?: IKbRetrieverConfig;
  /**
   * The application's tools, the tool timeout, the output cap and the error report (`ToolRegistry`). The gateway adds its
   * built-in tools (the user-memory tools, `dyna_aigw_ask_user_question`) in front of them.
   *
   * @default {} - no tools of the application; the built-in ones are still there
   */
  toolRegistry?: IToolRegistryConfig;
  /**
   * The rules the `ToolPolicy` applies to every run: which permission unlocks which tools, and the guarded workflows
   * (`requires`).
   *
   * @default {}
   */
  toolPolicy?: IToolPolicyConfig;
  /**
   * What the gateway applies to the skills of every profile and call (D124): the caps `maxSkills` (default 50) and
   * `maxBodyChars` (default 50 000). The skills themselves are on the profile (`IAIProfile.skills`) and on the call
   * (`IGatewayAskInput.skills`), never here.
   *
   * @default {}
   */
  skillRegistry?: ISkillRegistryConfig;
  /** Where paused runs live: the repository of the `RunStore`. */
  runStore: IRunStoreConfig;
  /** How long a pause waits for the human, and whether the model may ask the user a question (`HumanGate`). */
  humanGate: IHumanGateConfig;
  /**
   * The app's usage adapter, asked before every model call and told after it.
   *
   * > The gateway holds no token logic: who may spend what is the app's decision, made in `adapter.check`; what was spent is
   * > reported to `adapter.addUsage`.
   *
   * @example {adapter: new InMemoryUsageAdapter()} - tests and the sandbox: approves everything, records every call
   */
  usageGuard: IUsageGuardConfig;
  /**
   * The application's input and output rules, their timeout and the prompt length cap (`Guardrails`).
   *
   * @default {} - the built-in checks only
   */
  guardrails?: IGuardrailsConfig;
  /** The provider credentials, the per-call timeout and the retries of a model call (`LLMClient`). */
  llmClient: ILLMClientConfig;
  /**
   * How the system prompt is assembled: the prompt-cache switches (`promptCaching`, `sharePromptCacheAcrossTenants`) and
   * the tokens reserved for the answer.
   *
   * @example {promptCaching: true, sharePromptCacheAcrossTenants: false} - the stable part of every call is cached, per tenant
   */
  contextAssembler: IContextAssemblerConfig;
  /** Where the trace entries live: the repository of the `Trace`. */
  trace: ITraceConfig;
  /**
   * How many documents are ingested at once (`KbIngestor`).
   *
   * @default {}
   */
  kbIngestor?: IKbIngestorConfig;
  /** Platform-wide cheap model for the helper calls (memory, query rewrite) when a profile names none; a judge falls back to the profile's own model. */
  defaultCheapModelId: string;
}

/**
 * Every child instance of the gateway, each as its `I<Class>` interface: what the orchestration functions receive as `deps`.
 *
 * Created once by `createGatewayDeps` from `IAIGatewayConfig` and the `IAIGatewayOverrides` factories, in dependency order,
 * and held by the `AIGateway` for its lifetime; the admin getters of the facade hand some of them out.
 */
export interface IAIGatewayDeps {
  /** The models and their caps. */
  modelRegistry: IModelRegistry;
  /** The profiles. */
  aiProfileStore: IAIProfileStore;
  /** The prompt templates, versioned. */
  promptTemplateStore: IPromptTemplateStore;
  /** Builds the model request of a call. */
  contextAssembler: IContextAssembler;
  /** Threads, turns and the lease. */
  threadStore: IThreadStore;
  /** Turns from prompts and results, messages from turns. */
  turnBuilder: ITurnBuilder;
  /** The uploaded files. */
  fileStore: IFileStore;
  /** The thread memory; the built-in `WorkingMemory` unless the host passes its own in `overrides`. */
  workingMemory: IWorkingMemory;
  /** The remembered facts of a user. */
  userMemoryStore: IUserMemoryStore;
  /** Cuts a Markdown document into chunks. */
  mdChunker: IMdChunker;
  /** Embeds texts. */
  embedder: IEmbedder;
  /** The chunks and their vectors. */
  vectorStore: IVectorStore;
  /** Rewrites a question before the search. */
  queryRewriter: IQueryRewriter;
  /** Searches the knowledge base for a call. */
  kbRetriever: IKbRetriever;
  /** Writes documents into the knowledge base; the second root the facade exposes. */
  kbIngestor: IKbIngestor;
  /** The tools: parsing and execution. */
  toolRegistry: IToolRegistry;
  /** Which tools a call gets and what happens to a call of them. */
  toolPolicy: IToolPolicy;
  /** The skills of a profile and a call. */
  skillRegistry: ISkillRegistry;
  /** The paused runs. */
  runStore: IRunStore;
  /** Pauses and resumes a run. */
  humanGate: IHumanGate;
  /** Asks the application's usage adapter before a model call and tells it after. */
  usageGuard: IUsageGuard;
  /** The input and output checks. */
  guardrails: IGuardrails;
  /** The one place that calls a model. */
  llmClient: ILLMClient;
  /** The record of every model call. */
  trace: ITrace;
}

/**
 * A dep the host builds itself: the gateway hands it that dep's config and deps, exactly as it would to its own class.
 *
 * The members of `IAIGatewayOverrides`; `createGatewayDeps` calls a factory where one is given and `new <Class>(config, deps)` otherwise.
 */
export type TDepFactory<TConfig, TDeps, TDep> = (config: TConfig, deps: TDeps) => TDep;

/**
 * What a host (or a test) replaces in the gateway: one factory per dep, each receiving the dep's own config and deps.
 *
 * The second argument of the `AIGateway` constructor. A factory must return an object that implements the dep's
 * `I<Class>` interface; the usual body is `(config, deps) => new MyClass(config, deps)`. A dep without a config or without
 * deps receives `undefined` there.
 */
export interface IAIGatewayOverrides {
  /** Replaces the `ModelRegistry`; receives `IModelRegistryConfig`, no deps. */
  modelRegistry?: TDepFactory<IModelRegistryConfig, undefined, IModelRegistry>;
  /** Replaces the `AIProfileStore`; receives its config and `IAIProfileStoreDeps`. */
  aiProfileStore?: TDepFactory<IAIProfileStoreConfig, IAIProfileStoreDeps, IAIProfileStore>;
  /** Replaces the `PromptTemplateStore`; receives its config, no deps. */
  promptTemplateStore?: TDepFactory<IPromptTemplateStoreConfig, undefined, IPromptTemplateStore>;
  /** Replaces the `ContextAssembler`; receives its config and `IContextAssemblerDeps`. */
  contextAssembler?: TDepFactory<IContextAssemblerConfig, IContextAssemblerDeps, IContextAssembler>;
  /** Replaces the `ThreadStore`; receives its config, no deps. */
  threadStore?: TDepFactory<IThreadStoreConfig, undefined, IThreadStore>;
  /** Replaces the `TurnBuilder`; it has no config and no deps. */
  turnBuilder?: TDepFactory<undefined, undefined, ITurnBuilder>;
  /** Replaces the `FileStore`; receives its config, no deps. */
  fileStore?: TDepFactory<IFileStoreConfig, undefined, IFileStore>;
  /** Replaces the `WorkingMemory` (a host's own thread memory, D122); receives its config and `IWorkingMemoryDeps`. */
  workingMemory?: TDepFactory<IWorkingMemoryConfig, IWorkingMemoryDeps, IWorkingMemory>;
  /** Replaces the `UserMemoryStore`; receives its config and `IUserMemoryStoreDeps`. */
  userMemoryStore?: TDepFactory<IUserMemoryStoreConfig, IUserMemoryStoreDeps, IUserMemoryStore>;
  /** Replaces the `MdChunker`; receives its config, no deps. */
  mdChunker?: TDepFactory<IMdChunkerConfig, undefined, IMdChunker>;
  /** Replaces the `Embedder`; receives its config and `IEmbedderDeps`. */
  embedder?: TDepFactory<IEmbedderConfig, IEmbedderDeps, IEmbedder>;
  /** Replaces the `VectorStore`; receives its config, no deps. */
  vectorStore?: TDepFactory<IVectorStoreConfig, undefined, IVectorStore>;
  /** Replaces the `QueryRewriter`; receives its config and `IQueryRewriterDeps`. */
  queryRewriter?: TDepFactory<IQueryRewriterConfig, IQueryRewriterDeps, IQueryRewriter>;
  /** Replaces the `KbRetriever`; receives its config and `IKbRetrieverDeps`. */
  kbRetriever?: TDepFactory<IKbRetrieverConfig, IKbRetrieverDeps, IKbRetriever>;
  /** Replaces the `KbIngestor`; receives its config and `IKbIngestorDeps`. */
  kbIngestor?: TDepFactory<IKbIngestorConfig, IKbIngestorDeps, IKbIngestor>;
  /** Replaces the `ToolRegistry`; receives its config (the built-in tools already in front of the app's), no deps. */
  toolRegistry?: TDepFactory<IToolRegistryConfig, undefined, IToolRegistry>;
  /** Replaces the `ToolPolicy`; receives its config, no deps. */
  toolPolicy?: TDepFactory<IToolPolicyConfig, undefined, IToolPolicy>;
  /** Replaces the `SkillRegistry`; receives its config, no deps. */
  skillRegistry?: TDepFactory<ISkillRegistryConfig, undefined, ISkillRegistry>;
  /** Replaces the `RunStore`; receives its config, no deps. */
  runStore?: TDepFactory<IRunStoreConfig, undefined, IRunStore>;
  /** Replaces the `HumanGate`; receives its config and `IHumanGateDeps`. */
  humanGate?: TDepFactory<IHumanGateConfig, IHumanGateDeps, IHumanGate>;
  /** Replaces the `UsageGuard`; receives its config, no deps. */
  usageGuard?: TDepFactory<IUsageGuardConfig, undefined, IUsageGuard>;
  /** Replaces the `Guardrails`; receives its config and `IGuardrailsDeps`. */
  guardrails?: TDepFactory<IGuardrailsConfig, IGuardrailsDeps, IGuardrails>;
  /** Replaces the `LLMClient` (tests: a fake that answers without a provider); receives its config and `ILLMClientDeps`. */
  llmClient?: TDepFactory<ILLMClientConfig, ILLMClientDeps, ILLMClient>;
  /** Replaces the `Trace`; receives its config, no deps. */
  trace?: TDepFactory<ITraceConfig, undefined, ITrace>;
}

/**
 * What `AIGateway.delete` removes: the threads of a tenant, of one of its users, or a chosen list.
 *
 * Taken by `AIGateway.delete`; raw ids, no user check (an admin surface).
 */
export interface IDeleteArgs {
  /** The tenant whose threads are deleted. */
  tenantId: string;
  /** `"all"` for every thread of the tenant (of the user when `userId` is given), or the ids to delete. */
  threadIds: TThreadIds;
  /** Narrows the deletion to this user's threads: an id of another user is ignored. */
  userId?: string;
}

/** What `AIGateway.delete` did. */
export interface IDeleteResult {
  /** Threads deleted with all their content; a busy, unknown or foreign id is not counted. */
  threads: number;
}

/** What `deleteUserData` / `anonymizeUserData` did, place by place. The gateway keeps no usage of its own; what the app's usage adapter stored is the app's. */
export interface IForgetUserResult {
  /** Files deleted from the user's folder. */
  files: number;
  /** Threads deleted, or kept as skeletons. */
  threads: number;
  /** Turns deleted (in both methods). */
  turns: number;
  /** Remembered facts deleted (in both methods). */
  userFacts: number;
  /** Runs deleted, or kept as skeletons. */
  runs: number;
  /** Trace entries deleted, or kept as an audit skeleton. */
  traces: number;
  /** The id the kept rows carry now, `@anon-<uuid>`; null when everything was deleted. */
  pseudonym: string | null;
}

/**
 * The per-call overrides of the knowledge-base retrieval: how many chunks, and from which similarity on.
 *
 * `IGatewayAskInput.kbRetrieval`; `prepareCall` hands the values to `KbRetriever.retrieve`, whose config holds the defaults.
 */
export interface IKbRetrievalOptions {
  /** How many chunks at most, best first; the retriever's `k` (default 5) when omitted. */
  k?: number;
  /** The similarity below which a hit is dropped; the retriever's `minScore` (default 0.6) when omitted. */
  minScore?: number;
}

/**
 * Input of `ask()`: one grounded answer, no tools. `TStructured` is inferred from `outputSchema` and types the answer's
 * `structured`.
 *
 * Written by the host application per call. The base of `IGatewayRunInput` too (D104): everything here applies to `run()`
 * as well.
 */
export interface IGatewayAskInput<TStructured = unknown> {
  /** Who is asking; scopes every read and write of the call. */
  userContext: IUserContext;
  /** Existing thread of the calling user, or omit to create one. A thread of another user of the tenant is a 404, like an unknown one. */
  threadId?: string;
  /**
   * The profile this call runs on: its model, tools, approvals and limits (D46, D103).
   *
   * Chosen per call, never stored on the thread, so the next call of the same thread may run on another profile. The
   * application resolves the user's choice, or its own fallback when the user picked none, to an id before the call: the
   * gateway knows no default profile.
   *
   * @example "claude" - the profile the user picked in the model menu
   */
  profileId: string;
  /** The user's own words: the message of this turn, stored as the user turn and sent to the model. */
  prompt: string;
  /**
   * Instructions of the app for this call, placed in the system prompt after the profile's `promptAddendum`.
   *
   * > Lets one screen, button or user role steer the model without a profile per case.
   *
   * Use it for a rule that holds for this call only. A rule for every call of a tenant belongs in `IAIProfile.promptAddendum`;
   * the user's own words belong in `prompt`. Given to the model as instructions: the app is trusted code.
   * Not stored: a paused run keeps its system prompt, so `resume()` takes none; pass it again on the next call that needs it.
   *
   * @example "Summarise the invoice in three bullet points." - the "Summarise" button of the invoice screen
   * @example "The user is an administrator: you may mention internal notes." - the same screen, opened by an admin
   *
   * @see docs/60-architecture/40-system-prompt-production-layers.md
   */
  instructions?: string;
  /**
   * Data of the app about the situation of this call, placed in the system prompt after `instructions`.
   *
   * > Shows the model what the user is looking at, which it cannot see otherwise.
   *
   * Use it for the open record, the selection or the step of a wizard. Rendered under a "data, not instructions" label, like
   * memory and knowledge base, because it often carries user-typed values. Not for documents (knowledge base) or for lasting
   * facts about the user (memory). Same lifetime as `instructions`.
   *
   * @example "Invoice 4711, customer Nordwind GmbH, status OVERDUE, due 2026-09-30, open amount 1 250 EUR" - the invoice on screen
   * @example "Wizard 'New order', step 2 of 4: delivery address" - where the user is in a flow
   *
   * @see docs/60-architecture/40-system-prompt-production-layers.md
   */
  context?: string;
  /**
   * Instructions the model may load for this call, on top of the profile's `skills` (D124).
   *
   * > What one screen or flow knows and the model should read only when the task needs it.
   *
   * `run()`: listed by name and description in the system prompt with the profile's; the model loads a body with the built-in
   * `dyna_aigw_load_skill` tool (one model step per load, under `maxStepsPerRun`). `ask()`: the bodies are inlined in the prompt; no
   * tool. A name that is also in the profile's `skills`, or twice here, is a 400 before anything is stored. A run that pauses
   * stores them: `resume()` takes none. Not for a rule of every call (`IAIProfile.skills`, `promptAddendum`), nor for the
   * rule of this one call that the model must always read (`instructions`).
   *
   * @example [{name: "export_wizard", description: "How the CSV export works and its limits", body: "…"}] - the help text of the screen the user is on
   */
  skills?: ISkill[];
  /** Already stored through uploadFile(). */
  files?: IFileRef[];
  /** Zod schema for a structured answer. */
  outputSchema?: ZodType<TStructured>;
  /**
   * How the text answer is formatted. Ignored when `outputSchema` is given: the schema fixes the shape (D42).
   *
   * @default EOutputFormat.MARKDOWN
   */
  outputFormat?: EOutputFormat;
  /**
   * Sampling temperature of the main model call; omit for the provider's default.
   * Scales the randomness of each token draw: 0 = the most likely token every time (repeatable, fewest inventions),
   * higher = more varied and more creative. Not a knowledge knob: a wrong answer at 0 is still wrong, only consistent.
   * Valid range is the provider's (OpenAI 0–2, Anthropic 0–1); a value outside it fails the call at the provider.
   * Only on a model whose registry entry has `caps.temperature`: the call is refused (400) before anything is stored when the
   * profile's model does not accept one (D82). The OpenAI reasoning models (GPT-5 family) do not.
   *
   * | Call                            | Temperature |
   * | ------------------------------- | ----------- |
   * | Extraction, classification      | 0           |
   * | Factual answer over KB chunks   | 0 – 0.3     |
   * | Open conversation               | 0.5 – 0.7   |
   * | Creative drafts, brainstorming  | 0.8 – 1.0   |
   */
  temperature?: number;
  /**
   * The knowledge-base scope of the call: the libraries and books it may search. Required: the caller decides it on every call.
   * No KB for this call: `{libraryIds: [], bookIds: []}`. Every library of the tenant: `{libraryIds: "all", bookIds: []}`.
   */
  kbFilters: IChunkFilters;
  /**
   * Per-call overrides of the retriever's `k` and `minScore` (`IKbRetrieverConfig`), for a question that needs more or fewer
   * chunks than the gateway's default.
   *
   * > `kbFilters` says where to search; this says how much of what is found reaches the prompt.
   *
   * Omit it for the config's values. Not read on a resume: a resumed run keeps the chunks of its first step (D36).
   *
   * @example {k: 10} - a question that spans several documents
   * @example {minScore: 0.7} - a sensitive use case: a wrong chunk in the prompt is worse than "not in the knowledge base"
   */
  kbRetrieval?: IKbRetrievalOptions;
  /**
   * Stops the call when it is aborted: the user pressed "stop", the HTTP request closed, the app gave up.
   *
   * > One signal ends the model call in flight, the agent loop and the tools, and the tenant stops paying.
   *
   * The call returns FAILED with the reason "The call was aborted" and one ERROR issue with the code `call_aborted`; nothing is
   * thrown. A signal of `AbortSignal.timeout` counts as a deadline: "The call timed out", `call_timed_out`. What the call stored
   * before the stop stays: the user turn, and in a run the steps that completed (the tools did run; a tool call the abort cut
   * gets an error result); no answer is stored, an aborted run never pauses. Combined with `timeoutMs` when both are given: the
   * first one that fires wins.
   * An abort is **cooperative** for a tool: the gateway aborts the tool's `abortSignal` and stops waiting; a tool that ignores it
   * runs to its end, and an abort never undoes what a tool already did.
   *
   * @example controller.signal - an `AbortController` the UI aborts on its "stop" button
   * @example signalOfTheRequest - the signal of the incoming HTTP request, so a closed tab ends the call
   */
  abortSignal?: AbortSignal;
  /**
   * Deadline of the whole call in milliseconds, model calls and tools included.
   *
   * > A call that does not answer in time is stopped, not left running at the tenant's cost.
   *
   * Past it the call returns FAILED with the reason "The call timed out after N ms" and one ERROR issue with the code
   * `call_timed_out`; everything in flight is aborted as with `abortSignal`. Independent of the per-model-call timeout
   * (`ILLMClientConfig.timeoutMs`) and the per-tool timeout (`IToolDef.timeoutMs`): those cap one call or one tool, this caps
   * the sum. Two waits do not take the signal yet and overrun it: the knowledge-base search (query rewrite, embedding) and a
   * tool's policy predicate; a deadline that passes during them is seen when they return. Must be a positive integer up to
   * 2 147 483 647 (Node's largest timer); the call is refused with a 400 before anything is stored otherwise.
   *
   * @example 30_000 - a chat answer the user is waiting for on screen
   * @example 240_000 - an agent run with several tools, under the thread lease (`IThreadStoreConfig.leaseMs`, 300 000 by default)
   */
  timeoutMs?: number;
  /**
   * Attach the model-side transcript to the answer (`IAnswerResponse.debug`) for debugging. It carries the system prompt
   * and every tool output, so it is large and sensitive; never pass it through to an end user.
   *
   * @default false
   */
  debug?: boolean;
}

/** Input of run(): an agent run with tools (D104). Everything of `IGatewayAskInput`, plus the tools of this call. */
export interface IGatewayRunInput<TStructured = unknown> extends IGatewayAskInput<TStructured> {
  /**
   * The tools this call offers the model, by name — narrows what the profile and the user's permissions allow, never widens it
   * (a name outside that set is a 400). Omit for all of them; `[]` for none (D48).
   */
  activeTools?: string[];
  /**
   * Tools added for this call, on top of the registry's (D66). The app passes them, so they are allowed without the
   * profile's `allowedTools`; permissions, the tool's `policy` (D87), the profile's `approvals`, timeout and output cap apply as
   * for every tool. A name that exists in the registry, or twice here, is a 400. A run that pauses stores their names only:
   * `resume()` must receive the same `additionalTools` again.
   */
  additionalTools?: IToolDef[];
}

/**
 * What ask(), run() and resume() return, at once (D38). Read `events` to stream, await `response` for the result; a backend
 * service that needs no streaming awaits `response` only.
 */
export interface IGatewayCall<TStructured = unknown> {
  /**
   * Every event of the call, in order, buffered until read. One reader. Ends when `response` settles; throws the call's
   * error when the call throws. A stream nobody reads never slows the call.
   * Collected only from the first access: access `events` before your first `await` (e.g. `const {events, response} = gateway.ask(input)`);
   * a caller that never accesses it costs no memory for the events.
   */
  events: AsyncIterable<ILLMClientEvent>;
  /** The final response. Rejects with the dynaError of what the caller got wrong or the provider broke. */
  response: Promise<TGatewayResponse<TStructured>>;
}

/** What the business service gets back. Discriminated by kind. */
export type TGatewayResponse<TStructured = unknown> =
  | IAnswerResponse<TStructured>
  | IPausedResponse
  | IFailedResponse;

/** Response kinds: the discriminant of `TGatewayResponse`. */
export enum EGatewayResponseKind {
  /** The call finished with an answer (`IAnswerResponse`). */
  ANSWER = "ANSWER",
  /** The run stopped for a human (`IPausedResponse`). */
  PAUSED = "PAUSED",
  /** The call could not be completed (`IFailedResponse`). */
  FAILED = "FAILED",
}

/**
 * A finished answer: the text, the structured value when a schema was given, what it was grounded on, its warnings and
 * its cost.
 *
 * The `response` of `ask()`, of a `run()` the model finished and of a `resume()` that finished the run; the host renders
 * it and keeps `threadId` for the next call.
 */
export interface IAnswerResponse<TStructured = unknown> {
  /** The discriminant of `TGatewayResponse`. */
  kind: EGatewayResponseKind.ANSWER;
  /** The thread the turns were stored in: the one the call named, or the one it created. */
  threadId: string;
  /** The answer as the model wrote it, in the call's `outputFormat`; with an `outputSchema`, the raw text `structured` was parsed from. */
  text: string;
  /** The parsed, schema-checked answer; present when the input had an outputSchema. */
  structured?: TStructured;
  /** The ids of the knowledge-base chunks the model was given, not of the ones the answer rests on. */
  citations: string[];
  /** The WARNING issues of the call (guardrails, a refused later step, the assembler), for the UI to flag. */
  issues: IIssue[];
  /** Tokens of the call; for a run, the sum over its steps. */
  usage: IUsage;
  /**
   * Name of the tool that ended the run (D86), when a tool did.
   *
   * > Lets the UI tell "the assistant handed over / placed the order and closed" from "the assistant answered".
   *
   * Set when a tool with `endsRun` ran: the text is the model's closing sentence after that tool. Absent on `ask()` and on a
   * run the model ended by answering.
   *
   * @example "handover_to_agent" - the UI switches the thread to the human agent's queue
   */
  endedByTool?: string;
  /** The model-side transcript of the call; present when the input had `debug: true`. */
  debug?: IAnswerDebug;
}

/** What `debug: true` attaches to an answer: the exact messages the model saw and produced, and how many model calls it took. */
export interface IAnswerDebug {
  /** The system prompt as sent. */
  system: string;
  /** The context sent to the model and everything the call produced (assistant text, tool calls, tool results), in order. */
  messages: IMessage[];
  /** Model calls made; 1 for ask(). */
  steps: number;
  /**
   * The stored run after the resume settled: status DONE, `pending` cleared (the envelopes are the ones of the PAUSED response), the
   * messages up to the pause (the whole transcript is `messages` above), `toolNames`, the step-1 `request`, the run's dates.
   * Only on the answer of resume(), where a run exists in the RunStore; never on ask(), and never on a run() that finished without
   * pausing (such a run is not stored).
   */
  run?: IRun;
}

/**
 * The run stopped for a human: a tool call waits for an approval, the model asked the user a question, or the answer waits
 * for a review.
 *
 * The `response` of a `run()` or `resume()` that paused; the host shows the `envelopes` as cards and calls
 * `AIGateway.resume` with one decision per envelope.
 */
export interface IPausedResponse {
  /** The discriminant of `TGatewayResponse`. */
  kind: EGatewayResponseKind.PAUSED;
  /** The thread of the run; it stays AWAITING_HUMAN until the run is resumed, cancelled or expired. */
  threadId: string;
  /** Names this pause of the run; `resume` must pass it (the envelopes carry it too). A later pause of the same run has another. */
  pauseId: string;
  /**
   * The cards the human answers, one per tool call of the step that waits (D102), or the one review of the answer (D99).
   *
   * > A parallel step may hold several calls back at once; the UI shows every card, and `resume` takes a decision for each.
   *
   * Never empty. Each envelope carries the `callId` a decision names; a RESULT_REVIEW is always alone, and without its
   * `result` here: the draft is the reviewer's (`AIGateway.getPausedRun`).
   */
  envelopes: TPauseEnvelopes;
}

/**
 * A run that waits for a human, as the asker's UI lists it: no request, no messages, no draft answer.
 *
 * Returned by `AIGateway.listPausedRuns`, one per paused run of the calling user; `AIGateway.getPausedRun` gives the whole
 * stored run for the reviewer's screen.
 */
export interface IPausedRunSummary {
  /** The run; `resume` and `cancelRun` take it. */
  runId: string;
  /** The thread the run belongs to. */
  threadId: string;
  /** The profile the run started with; a resume may name another. */
  profileId: string;
  /** The pause the run waits on; `resume` takes it. */
  pauseId: string;
  /** The cards of the pause, as in the PAUSED response: a RESULT_REVIEW without its `result`. */
  envelopes: TPauseEnvelopes;
  /** When the run started. */
  createdAt: Date;
  /** When the pause expires; past it `AIGateway.expirePausedRuns` cancels the run. */
  expiresAt: Date;
}

/**
 * The call could not be completed: a check failed it, the usage adapter refused it, it was aborted or timed out, or the
 * reviewer rejected the answer.
 *
 * The `response` of any of the three calls; never thrown. The host shows `reason` or the issues' `userMessage` and decides
 * whether to retry. What the caller got wrong (a 400, a 404) rejects `response` instead.
 */
export interface IFailedResponse {
  /** The discriminant of `TGatewayResponse`. */
  kind: EGatewayResponseKind.FAILED;
  /** The thread of the call, when it got as far as having one; absent when the call was refused before a thread existed. */
  threadId?: string;
  /** Why, in words, for the log and the developer; the end user reads the issues' `userMessage`. */
  reason: string;
  /**
   * Why, for code: the input or output rules' issues, `USAGE_DENIED_ISSUE_CODE`, or the one issue of a
   * stopped call, `CALL_ABORTED_ISSUE_CODE` / `CALL_TIMED_OUT_ISSUE_CODE`.
   */
  issues: IIssue[];
}

/** The `code` of the one issue of a call the caller's `abortSignal` stopped (`IFailedResponse.issues`). */
export const CALL_ABORTED_ISSUE_CODE = "call_aborted";
/** The `code` of the one issue of a call that passed its `timeoutMs` (`IFailedResponse.issues`). */
export const CALL_TIMED_OUT_ISSUE_CODE = "call_timed_out";
/**
 * The `code` of the issue of a model call the usage adapter refused: ERROR on a FAILED response, WARNING on the truncated
 * answer of a run whose later step was refused. Its `userMessage` is the adapter's `denyUserMessage`, its `data.denyCode`
 * the adapter's `denyCode`.
 */
export const USAGE_DENIED_ISSUE_CODE = "usage_denied";
/** The `code` of the one issue of a reviewed answer the reviewer rejected (D99): the answer was dropped, the `reason` is the reviewer's text (`IFailedResponse.issues`). */
export const ANSWER_REJECTED_ISSUE_CODE = "answer_rejected";
