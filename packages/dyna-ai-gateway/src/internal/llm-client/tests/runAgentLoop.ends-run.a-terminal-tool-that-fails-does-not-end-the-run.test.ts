import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** A tool that threw did not run (D76): it cannot have ended anything; the loop continues with the step's tools. */
test("a terminal tool that throws does not end the run", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover")]},
      {text: "The hand-over failed; I stay with you."},
    ],
    failing: ["handover"],
  });
  const outcome = await probe.run();

  expect(outcome.endedByTool).toBeUndefined();
  expect(probe.modelCalls[1]?.tools.map(tool => tool.name)).toEqual(["handover", "log_event", "get_invoice"]);
});
