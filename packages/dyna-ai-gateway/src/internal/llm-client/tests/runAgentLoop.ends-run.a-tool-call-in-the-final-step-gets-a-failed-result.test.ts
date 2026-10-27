import {
  EPartKind,
} from "../../../contracts";

import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** The final step offers no tools; a model that calls one anyway gets a failed result, and the transcript stays valid. */
test("a tool call the model makes in the final step is not executed: it gets a failed result and the text is the answer", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover")]},
      {
        toolCalls: [makeCall("log_event", "call-late")],
        text: "Handed over.",
      },
    ],
  });
  const outcome = await probe.run();

  expect([outcome.endedByTool, outcome.result?.text, outcome.result?.toolCalls, probe.executed]).toEqual(["handover", "Handed over.", [], ["handover"]]);
  const lateResult = outcome.messages.flatMap(message => message.parts).find(part => part.kind === EPartKind.TOOL_RESULT && part.callId === "call-late");
  expect(lateResult && "failed" in lateResult ? lateResult.failed : undefined).toBe(true);
  expect(probe.modelCalls.length).toBe(2);
});
