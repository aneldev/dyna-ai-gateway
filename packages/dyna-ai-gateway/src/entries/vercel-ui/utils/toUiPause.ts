import {
  IPausedResponse,
  IPausedRunSummary,
} from "../../..";

import {IUiPause} from "../types";

/** The pause as the client sees it, from the PAUSED response of a call or from the asker's list of paused runs. */
export const toUiPause = (pause: IPausedResponse | IPausedRunSummary): IUiPause => {
  const [first] = pause.envelopes;
  return {
    runId: first.runId,
    pauseId: pause.pauseId,
    kind: first.kind,
    expiresAt: first.expiresAt.toISOString(),
    envelopes: pause.envelopes,
  };
};
