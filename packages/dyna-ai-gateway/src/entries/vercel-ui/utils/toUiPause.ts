import {
  IPausedResponse,
  IPausedRunSummary,
} from "../../..";

import {IUiPause} from "../types";

/**
 * toUiPause -- the pause as the client sees it
 *
 * # About
 *
 * > The ids `resume` takes and the envelopes, with the expiry as an ISO string.
 *
 * From the PAUSED response of a call or from the asker's list of paused runs: the same `IUiPause` either way, so a
 * pause looks the same streamed and in the history. `runId`, `kind` and `expiresAt` are read off the first envelope:
 * one pause is one run, one kind, one expiry (D102).
 *
 * # Who needs it
 *
 * `UiChunkWriter` on a PAUSED response, `AIGatewayVercelUi.history` for the thread's paused run.
 */
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
