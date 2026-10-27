import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** Step-level (D86): the calls the model requested together are one batch; the one after the terminal tool runs too. */
test("the other calls of the same step still run after the terminal tool; the run ends after the step", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover"), makeCall("log_event")]},
      {text: "Done."},
    ],
  });
  const outcome = await probe.run();

  expect(probe.executed).toEqual(["handover", "log_event"]);
  expect([outcome.endedByTool, probe.modelCalls.length, probe.modelCalls[1]?.tools]).toEqual(["handover", 2, []]);
});
