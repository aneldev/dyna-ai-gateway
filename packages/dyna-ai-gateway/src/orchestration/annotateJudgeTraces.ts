import {IIssue} from "../contracts";
import {IAIGatewayDeps} from "../types";

import {annotateTraces} from "./annotateTraces";

/**
 * annotateJudgeTraces -- puts a check's issues on the trace entries of its judge calls
 *
 * # About
 *
 * > The judge's own entry says what the judge found (D73).
 *
 * A guardrail check with a judge rule records GUARDRAIL_JUDGE entries through the LLMClient; without this, a rejected
 * prompt left no issue anywhere in the trace. No chunk ids and no template on these entries: the judge's request was
 * not rendered from the chat template.
 *
 * # Who needs it
 *
 * `prepareCall` (input check), `AIGateway.ask` and `settleRun` (output check), `AIGateway.resume` (the answer check, D71).
 */
export const annotateJudgeTraces = (
  {
    deps,
    tenantId,
    traceIds,
    issues,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    traceIds: string[];
    issues: IIssue[];
  },
): Promise<void> => annotateTraces({
  deps,
  tenantId,
  traceIds,
  chunkIds: [],
  issues,
});
