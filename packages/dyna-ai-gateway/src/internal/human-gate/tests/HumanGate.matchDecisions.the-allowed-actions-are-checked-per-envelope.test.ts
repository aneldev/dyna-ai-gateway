import {EResumeAction} from "../types";

import {
  approvalEnvelope,
  ids,
  questionEnvelope,
  setupPaused,
} from "./utils/humanGateFixtures";

/**
 * Each card keeps its own actions: APPROVE on the user-question envelope is a 400 although the approval envelope next to it
 * allows APPROVE. The error names the envelope's `callId` and its `allowed`.
 */
test("an action is checked against the allowed actions of its own envelope, not of the pause", async () => {
  jest.useFakeTimers();
  try {
    const {
      gate, pauseId,
    } = await setupPaused([approvalEnvelope("call-1"), questionEnvelope("call-2")]);

    await expect(gate.resume({
      ...ids,
      pauseId,
      decisions: [
        {
          callId: "call-1",
          action: EResumeAction.APPROVE,
        },
        {
          callId: "call-2",
          action: EResumeAction.APPROVE,
        },
      ],
    })).rejects.toMatchObject({
      code: 5372577355281,
      status: 400,
      data: {
        callId: "call-2",
        allowed: [EResumeAction.ANSWER],
      },
    });
  }
  finally {
    jest.useRealTimers();
  }
});
