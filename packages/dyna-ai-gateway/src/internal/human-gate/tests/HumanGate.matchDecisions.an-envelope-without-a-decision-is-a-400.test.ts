import {ERunStatus} from "../../run-store";

import {EResumeAction} from "../types";

import {
  approvalEnvelope,
  ids,
  setupPaused,
} from "./utils/humanGateFixtures";

/** All or nothing: a resume that answers one of two envelopes is refused with a 400, and the run stays PAUSED. */
test("a pause of two envelopes refuses a resume that decides only one of them", async () => {
  jest.useFakeTimers();
  try {
    const {
      gate,
      runStore,
      pauseId,
    } = await setupPaused([approvalEnvelope("call-1"), approvalEnvelope("call-2")]);

    await expect(gate.resume({
      ...ids,
      pauseId,
      decisions: [{
        callId: "call-1",
        action: EResumeAction.APPROVE,
      }],
    })).rejects.toMatchObject({
      code: 5376634521043,
      status: 400,
      data: {unanswered: ["call-2"]},
    });
    expect((await runStore.load(ids)).status).toBe(ERunStatus.PAUSED);
  }
  finally {
    jest.useRealTimers();
  }
});
