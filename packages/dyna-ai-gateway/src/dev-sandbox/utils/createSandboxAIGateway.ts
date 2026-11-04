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

/**
 * What the sandbox built from a config: the gateway, the config it actually received, and the two adapters the debugger reads.
 *
 * Returned by `createSandboxAIGateway`; `sandbox.cli.ts` takes the gateway and the filters, `sandbox.debug.ts` all of it.
 */
export interface ISandboxAIGateway {
  /** The config the gateway received: the given one with the sandbox's trace, vector adapter, tool-error and rule-error printing. */
  config: IAIGatewayConfig;
  /** The gateway built from `config`. */
  aiGateway: AIGateway;
  /** The trace that printed every model call; `traces` has the entries. */
  traceRepository: ConsoleTraceRepository;
  /** The vector index; `chunks` lists what was ingested. */
  vectorIndexAdapter: DebugVectorIndexAdapter;
  /** The knowledge-base scope of every call: every library when the config ingested the samples, otherwise none. */
  kbFilters: IChunkFilters;
}

/**
 * createSandboxAIGateway -- the gateway of a config, ready to be called
 *
 * # About
 *
 * > The given config, with the sandbox's eyes added: a printing trace, a listing vector index, printed tool and rule errors.
 *
 * Swaps the trace repository for `ConsoleTraceRepository` and the vector adapter for `DebugVectorIndexAdapter` (both read
 * by the debugger session), wraps `onToolError` and `onRuleError` so every failed tool call and guardrail rule prints on
 * the `TRACE` channel before the config's own handler runs, builds the `AIGateway`, and ingests the sample knowledge base
 * when the config registers its embedding model (`ingestSampleKb`).
 *
 * # Who needs it
 *
 * Both entries: `sandbox.cli.ts` and `sandbox.debug.ts`.
 *
 * # Pitfalls
 *
 * The output mode is read from the environment here (`getDevOutputMode`): an unknown `AIGATEWAY_DEV_OUTPUT_MODE` throws
 * before the gateway exists.
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
