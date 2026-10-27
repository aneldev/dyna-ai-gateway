import {EResumeAction} from "../types";

import {
  approvalEnvelope,
  ids,
  setupPaused,
} from "./utils/humanGateFixtures";

/**
 * `callId` may be omitted only when the pause carries one envelope. With two envelopes a decision without it is a 400, even
 * when a second decision names the other envelope: nothing says which card the first one answers.
 */
test("a decision without callId is refused when the pause carries two envelopes", async () => {
  jest.useFakeTimers();
  try {
    const {
      gate, pauseId,
    } = await setupPaused([approvalEnvelope("call-1"), approvalEnvelope("call-2")]);

    await expect(gate.resume({
      ...ids,
      pauseId,
      decisions: [
        {action: EResumeAction.APPROVE},
        {
          callId: "call-2",
          action: EResumeAction.APPROVE,
        },
      ],
    })).rejects.toMatchObject({
      code: 5376634521029,
      status: 400,
      data: {callIds: ["call-1", "call-2"]},
    });
  }
  finally {
    jest.useRealTimers();
  }
});
