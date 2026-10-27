import {IIssue} from "../contracts";
import {EPromptTemplateKey} from "../internal";
import {IAIGatewayDeps} from "../types";

/**
 * Adds what the gateway knows to the trace entries the LLMClient recorded for a call: issues, chunk ids, the template version.
 * The trace is an audit: an annotation that fails is reported and does not fail the call.
 */
export const annotateTraces = async (
  {
    deps,
    tenantId,
    traceIds,
    chunkIds,
    issues,
    templateVersion,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    traceIds: string[];
    chunkIds: string[];
    issues: IIssue[];
    /** Version of CHAT_MAIN the request was rendered from; unknown on a resume. */
    templateVersion?: number;
  },
): Promise<void> => {
  for (const traceId of traceIds) {
    try {
      await deps.trace.annotate({
        tenantId,
        traceId,
        chunkIds,
        issues,
        templateKey: templateVersion === undefined ? undefined : EPromptTemplateKey.CHAT_MAIN,
        templateVersion,
      });
    }
    catch (error) {
      console.error(`AIGateway error 53736440364301: the trace entry [${traceId}] could not be annotated`, error);
    }
  }
};
