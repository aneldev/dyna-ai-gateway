import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** The hook decides on the output: a hand-over that was only queued is not the end. */
test("when the endsRun hook says no for this call's output, the run continues with its tools", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover")]},
      {text: "You are in the queue; anything else meanwhile?"},
    ],
    outputs: {handover: {status: "queued"}},
  });
  const outcome = await probe.run();

  expect([outcome.endedByTool, probe.executed]).toEqual([undefined, ["handover"]]);
  expect(probe.modelCalls[1]?.tools.length).toBe(3);
});
