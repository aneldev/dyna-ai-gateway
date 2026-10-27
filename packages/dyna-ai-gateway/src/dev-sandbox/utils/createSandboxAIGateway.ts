import {
  IAIGatewayConfig,
  IChunkFilters,
  AIGateway,
} from "../..";
import {sampleUser} from "../../tests/internal/samples/profiles";

import {ConsoleTraceRepository} from "./ConsoleTraceRepository";
import {DebugVectorIndexAdapter} from "./DebugVectorIndexAdapter";
import {getDevOutputMode} from "./devOutputMode";
import {ingestSampleKb} from "./ingestSampleKb";
import {printRuleErrorReport} from "./printRuleErrorReport";
import {printToolErrorReport} from "./printToolErrorReport";

export interface ISandboxAIGateway {
  /** The config the gateway received: the given one with the sandbox's trace, vector adapter, tool-error and rule-error printing. */
  config: IAIGatewayConfig;
  aiGateway: AIGateway;
  /** The trace that printed every model call; `traces` has the entries. */
  traceRepository: ConsoleTraceRepository;
  /** The vector index; `chunks` lists what was ingested. */
  vectorIndexAdapter: DebugVectorIndexAdapter;
  /** The knowledge-base scope of every call: every library when the config ingested the samples, otherwise none. */
  kbFilters: IChunkFilters;
}

/**
 * The gateway of a config, ready to be called: the trace swapped for the printing one and the vector index for the listing one
 * (both read by the debugger session), every failed tool call and every failed guardrail rule printed on the TRACE channel
 * (`onToolError`, `onRuleError`, each in front of the config's own handler), the sample knowledge base ingested when the config
 * registers its embedding model.
 */
export const createSandboxAIGateway = async (
  {config: givenConfig}: {config: IAIGatewayConfig},
): Promise<ISandboxAIGateway> => {
  const outputMode = getDevOutputMode();
  const traceRepository = new ConsoleTraceRepository({outputMode});
  const vectorIndexAdapter = new DebugVectorIndexAdapter({
    embeddingModelId: givenConfig.embedder.embeddingModelId,
    dimensions: givenConfig.embedder.dimensions,
  });
  const givenOnToolError = givenConfig.toolRegistry?.onToolError;
  const givenOnRuleError = givenConfig.guardrails?.onRuleError;
  const config: IAIGatewayConfig = {
    ...givenConfig,
    vectorStore: {adapter: vectorIndexAdapter},
    trace: {repository: traceRepository},
    toolRegistry: {
      ...givenConfig.toolRegistry,
      // The given config's own handler keeps running; the sandbox only adds the printing
      onToolError: async (report): Promise<void> => {
        printToolErrorReport({
          report,
          outputMode,
        });
        await givenOnToolError?.(report);
      },
    },
    guardrails: {
      ...givenConfig.guardrails,
      onRuleError: async (report): Promise<void> => {
        printRuleErrorReport({
          report,
          outputMode,
        });
        await givenOnRuleError?.(report);
      },
    },
  };
  const aiGateway = new AIGateway(config);
  const kbFilters = await ingestSampleKb({
    gateway: aiGateway,
    config,
    tenantId: sampleUser.tenantId,
  });
  return {
    config,
    aiGateway,
    traceRepository,
    vectorIndexAdapter,
    kbFilters,
  };
};
