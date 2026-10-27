import {
  AIGateway,
  EPauseKind,
} from "../../..";

import {sampleUser} from "../samples/profiles";

/** The draft answer of a review pause of the sample tenant, as the reviewer reads it (`getPausedRun`); "" when there is none. */
export const loadReviewDraft = async (
  {
    gateway,
    runId,
  }: {
    gateway: AIGateway;
    runId: string;
  },
): Promise<string> => {
  const run = await gateway.getPausedRun({
    tenantId: sampleUser.tenantId,
    runId,
  });
  const [card] = run.pending ?? [];
  return card?.kind === EPauseKind.RESULT_REVIEW ? card.result?.text ?? "" : "";
};
