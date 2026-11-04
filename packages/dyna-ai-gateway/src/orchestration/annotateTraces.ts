import {IIssue} from "../contracts";
import {EPromptTemplateKey} from "../internal";
import {IAIGatewayDeps} from "../types";

/**
 * annotateTraces -- adds what the gateway knows to the trace entries of a call
 *
 * # About
 *
 * > The LLMClient recorded the call; the gateway adds the issues, the chunk ids and the template version.
 *
 * Annotates every entry of `traceIds` through `Trace.annotate`. The template is CHAT_MAIN when `templateVersion` is given,
 * none otherwise (a judge call, a resume). The trace is an audit: an annotation that fails is logged (`53736440364301`)
 * and never fails the call.
 *
 * Runs after the output check, once the issues are complete: in `executeAsk`, `settleRun` and `settleReviewPause`, right
 * before the response is shaped.
 *
 * # Who needs it
 *
 * `AIGateway.executeAsk`, `settleRun`, `settleReviewPause`, and `annotateJudgeTraces` for the judge entries.
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
