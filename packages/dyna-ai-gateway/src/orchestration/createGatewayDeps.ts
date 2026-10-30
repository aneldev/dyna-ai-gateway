import {
  ModelRegistry,
  AIProfileStore,
  PromptTemplateStore,
  ThreadStore,
  TurnBuilder,
  FileStore,
  WorkingMemory,
  UserMemoryStore,
  MdChunker,
  Embedder,
  VectorStore,
  QueryRewriter,
  KbRetriever,
  ToolRegistry,
  ToolPolicy,
  SkillRegistry,
  RunStore,
  HumanGate,
  UsageGuard,
  Guardrails,
  LLMClient,
  ContextAssembler,
  Trace,
  KbIngestor,
  makeAskUserQuestionTool,
  makeUserMemoryTools,
} from "../internal";
import {
  IAIGatewayConfig,
  IAIGatewayDeps,
  IAIGatewayOverrides,
  TDepFactory,
} from "../types";

/** The composition root: every child is created once, in dependency order; an override's factory builds the instance everyone that depends on it gets. */
export const createGatewayDeps = (
  {
    config,
    overrides,
  }: {
    config: IAIGatewayConfig;
    /** Factories to use instead of the gateway's classes (a host's own dep; tests: `() => fakeLLMClient`). */
    overrides: IAIGatewayOverrides;
  },
): IAIGatewayDeps => {
  const modelRegistry = make(overrides.modelRegistry, config.modelRegistry, undefined, config => new ModelRegistry(config));
  const promptTemplateStore = make(overrides.promptTemplateStore, config.promptTemplateStore, undefined, config => new PromptTemplateStore(config));
  const turnBuilder = make(overrides.turnBuilder, undefined, undefined, () => new TurnBuilder());
  const threadStore = make(overrides.threadStore, config.threadStore, undefined, config => new ThreadStore(config));
  const fileStore = make(overrides.fileStore, config.fileStore, undefined, config => new FileStore(config));
  const mdChunker = make(overrides.mdChunker, config.mdChunker ?? {}, undefined, config => new MdChunker(config));
  const vectorStore = make(overrides.vectorStore, config.vectorStore, undefined, config => new VectorStore(config));
  const toolPolicy = make(overrides.toolPolicy, config.toolPolicy ?? {}, undefined, config => new ToolPolicy(config));
  const skillRegistry = make(overrides.skillRegistry, config.skillRegistry ?? {}, undefined, config => new SkillRegistry(config));
  const runStore = make(overrides.runStore, config.runStore, undefined, config => new RunStore(config));
  const trace = make(overrides.trace, config.trace, undefined, config => new Trace(config));

  const usageGuard = make(overrides.usageGuard, config.usageGuard, undefined, config => new UsageGuard(config));
  const llmClient = make(overrides.llmClient, config.llmClient, {
    modelRegistry,
    usageGuard,
    trace,
  }, (config, deps) => new LLMClient(config, deps));
  const guardrails = make(overrides.guardrails, config.guardrails ?? {}, {
    llmClient,
    modelRegistry,
  }, (config, deps) => new Guardrails(config, deps));
  const userMemoryStore = make(overrides.userMemoryStore, config.userMemoryStore, {
    llmClient,
    promptTemplateStore,
  }, (config, deps) => new UserMemoryStore(config, deps));
  // The gateway's own tools come first; an app tool with the same name is a duplicate the registry rejects (D61)
  const toolRegistry = make(overrides.toolRegistry, {
    ...config.toolRegistry,
    tools: [
      ...(config.userMemoryStore.enabled
        ? makeUserMemoryTools({
          userMemoryStore,
          rememberNeedsApproval: config.userMemoryStore.rememberNeedsApproval ?? true,
        })
        : []),
      ...(config.humanGate.userQuestions.enabled ? [makeAskUserQuestionTool()] : []),
      ...(config.toolRegistry?.tools ?? []),
    ],
  }, undefined, config => new ToolRegistry(config));
  const aiProfileStore = make(overrides.aiProfileStore, config.aiProfileStore, {
    modelRegistry,
    toolRegistry,
    runStore,
    skillRegistry,
  }, (config, deps) => new AIProfileStore(config, deps));
  const workingMemory = make(overrides.workingMemory, config.workingMemory, {
    llmClient,
    promptTemplateStore,
    threadStore,
    turnBuilder,
  }, (config, deps) => new WorkingMemory(config, deps));
  const contextAssembler = make(overrides.contextAssembler, config.contextAssembler, {
    promptTemplateStore,
    skillRegistry,
    turnBuilder,
    workingMemory,
  }, (config, deps) => new ContextAssembler(config, deps));
  const embedder = make(overrides.embedder, config.embedder, {llmClient}, (config, deps) => new Embedder(config, deps));
  const queryRewriter = make(overrides.queryRewriter, config.queryRewriter, {
    llmClient,
    promptTemplateStore,
  }, (config, deps) => new QueryRewriter(config, deps));
  const kbRetriever = make(overrides.kbRetriever, config.kbRetriever ?? {}, {
    queryRewriter,
    embedder,
    vectorStore,
  }, (config, deps) => new KbRetriever(config, deps));
  const kbIngestor = make(overrides.kbIngestor, config.kbIngestor ?? {}, {
    mdChunker,
    embedder,
    vectorStore,
  }, (config, deps) => new KbIngestor(config, deps));
  const humanGate = make(overrides.humanGate, config.humanGate, {runStore}, (config, deps) => new HumanGate(config, deps));

  return {
    modelRegistry,
    aiProfileStore,
    promptTemplateStore,
    contextAssembler,
    threadStore,
    turnBuilder,
    fileStore,
    workingMemory,
    userMemoryStore,
    mdChunker,
    embedder,
    vectorStore,
    queryRewriter,
    kbRetriever,
    kbIngestor,
    toolRegistry,
    toolPolicy,
    skillRegistry,
    runStore,
    humanGate,
    usageGuard,
    guardrails,
    llmClient,
    trace,
  };
};

/** The host's factory when there is one, the gateway's class otherwise; both get the same config and deps. */
const make = <TConfig, TDeps, TDep>(
  factory: TDepFactory<TConfig, TDeps, TDep> | undefined,
  config: TConfig,
  deps: TDeps,
  create: TDepFactory<TConfig, TDeps, TDep>,
): TDep => (factory ?? create)(config, deps);
