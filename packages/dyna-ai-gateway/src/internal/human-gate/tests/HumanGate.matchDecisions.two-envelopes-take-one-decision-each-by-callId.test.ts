import {
  EPauseKind,
  EResumeAction,
} from "../types";

import {
  approvalEnvelope,
  questionEnvelope,
  setupPaused,
  makeRun,
} from "./utils/humanGateFixtures";

/**
 * A pause of two envelopes (an approval and a user question) takes exactly one decision per envelope, each named by its
 * `callId`, in any order; the pairs come back in envelope order, each action checked against its own envelope's `allowed`.
 */
test("two envelopes take one decision each, matched by callId and returned in envelope order", async () => {
  jest.useFakeTimers();
  try {
    const {
      gate,
      runStore,
      pauseId,
    } = await setupPaused([approvalEnvelope("call-1"), questionEnvelope("call-2")]);
    const run = await runStore.load({
      tenantId: makeRun().tenantId,
      runId: makeRun().id,
    });

    const pairs = gate.matchDecisions({
      run,
      pauseId,
      decisions: [
        {
          callId: "call-2",
          action: EResumeAction.ANSWER,
          answers: [{
            question: "Order id",
            selected: [],
            freeText: "4521",
          }],
        },
        {
          callId: "call-1",
          action: EResumeAction.REJECT,
          text: "no",
        },
      ],
    });

    expect(pairs.map(pair => [pair.envelope.kind, "callId" in pair.envelope && pair.envelope.callId, pair.decision.action])).toEqual([
      [EPauseKind.TOOL_APPROVAL, "call-1", EResumeAction.REJECT],
      [EPauseKind.USER_QUESTION, "call-2", EResumeAction.ANSWER],
    ]);
  }
  finally {
    jest.useRealTimers();
  }
});
