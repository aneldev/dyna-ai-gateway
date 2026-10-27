import {
  IAIGatewayConfig,
  IIssue,
  IOutputRule,
  IUsageCheckArgs,
  IUsageCheckResult,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
  InMemoryUsageAdapter,
  InMemoryVectorIndexAdapter,
  ETraceKind,
} from "../..";

import {scopeJudgeRule} from "../guardrails/judge-scope.config";
import {
  openAiEmbeddingModel,
  openAiModel,
} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {getCurrentTimeTool} from "../internal/samples/tools";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The app's no, as the adapter answers it: its own code and its own words for the user. */
export const denial: IUsageCheckResult = {
  approved: false,
  denyCode: "plan_exhausted",
  denyUserMessage: "Your plan is used up for today.",
};

/** An adapter that answers `denial` to the calls `deny` picks and approves the rest. */
const denying = (deny: (call: IUsageCheckArgs) => boolean): InMemoryUsageAdapter =>
  new InMemoryUsageAdapter({deny: call => (deny(call) ? denial : false)});

/** An output rule whose judge (a model call) rates the tone of the answer. What the judge answers, the test scripts. */
export const toneJudgeRule: IOutputRule = {
  name: "tone",
  check: ({judge}): Promise<IIssue[]> => judge({
    instruction: "Report one issue with code `rude` and severity `error` when the answer is impolite.",
    chunks: false,
    toolResults: false,
  }),
};

/** The profile with the time tool: a run's first step calls it, the second step phrases the answer. */
const aiProfileStoreWithTimeTool: IAIGatewayConfig["aiProfileStore"] = {
  repository: new InMemoryAIProfileRepository({
    profiles: [{
      ...sampleProfile,
      allowedTools: [getCurrentTimeTool.name],
    }],
  }),
};

export const usageAdapterDenyingChat = denying(call => call.kind === ETraceKind.CHAT);
/** The app refuses the answer's own model call. */
export const gatewayConfigDenyChat: IAIGatewayConfig = {
  ...gatewayConfigBase,
  usageGuard: {adapter: usageAdapterDenyingChat},
};

export const usageAdapterDenyingInputJudge = denying(call => call.kind === ETraceKind.GUARDRAIL_JUDGE);
/** One judge rule on the prompt; the app refuses the judge's model call. */
export const gatewayConfigDenyInputJudge: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {inputRules: [scopeJudgeRule]},
  usageGuard: {adapter: usageAdapterDenyingInputJudge},
};

export const usageAdapterDenyingOutputJudge = denying(call => call.kind === ETraceKind.GUARDRAIL_JUDGE);
/** One judge rule on the answer; the app refuses the judge's model call after the answer was made. */
export const gatewayConfigDenyOutputJudge: IAIGatewayConfig = {
  ...gatewayConfigBase,
  guardrails: {outputRules: [toneJudgeRule]},
  usageGuard: {adapter: usageAdapterDenyingOutputJudge},
};

export const usageAdapterDenyingFirstRunStep = denying(call => call.kind === ETraceKind.RUN_STEP);
/** The time tool; the app refuses every run step, so the first one. */
export const gatewayConfigDenyFirstRunStep: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: aiProfileStoreWithTimeTool,
  toolRegistry: {tools: [getCurrentTimeTool]},
  usageGuard: {adapter: usageAdapterDenyingFirstRunStep},
};

let runStepsAsked = 0;
export const usageAdapterDenyingSecondRunStep = denying(call => call.kind === ETraceKind.RUN_STEP && ++runStepsAsked === 2);
/** The time tool; the app approves the first run step and refuses the second. */
export const gatewayConfigDenySecondRunStep: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: aiProfileStoreWithTimeTool,
  toolRegistry: {tools: [getCurrentTimeTool]},
  usageGuard: {adapter: usageAdapterDenyingSecondRunStep},
};

export const usageAdapterDenyingMemory = denying(call => call.kind === ETraceKind.MEMORY_WORKING);
/** The thread memory on; the app refuses the memory's helper call. */
export const gatewayConfigDenyMemory: IAIGatewayConfig = {
  ...gatewayConfigBase,
  workingMemory: {enabled: true},
  usageGuard: {adapter: usageAdapterDenyingMemory},
};

const EMBED_DIMENSIONS = 3;
/** The fake embedding of the KB scenario: any vector of the index's width. */
export const toVector = (): number[] => Array.from({length: EMBED_DIMENSIONS}, () => 1);
export const usageAdapterDenyingEmbed = denying(call => call.kind === ETraceKind.EMBED);
/** A knowledge base on fake embeddings; the app refuses the embedding of an ingestion. */
export const gatewayConfigDenyEmbed: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [openAiModel, openAiEmbeddingModel]})},
  embedder: {
    embeddingModelId: openAiEmbeddingModel.id,
    dimensions: EMBED_DIMENSIONS,
  },
  vectorStore: {
    adapter: new InMemoryVectorIndexAdapter({
      embeddingModelId: openAiEmbeddingModel.id,
      dimensions: EMBED_DIMENSIONS,
    }),
  },
  usageGuard: {adapter: usageAdapterDenyingEmbed},
};
