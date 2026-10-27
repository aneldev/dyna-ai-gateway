import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** A call to a tool hidden in this step is refused by the execute hook (D72); a refused call ends nothing. */
test("a terminal tool the step did not offer is refused and does not end the run", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover")]},
      {text: "I cannot hand over yet."},
    ],
    offered: ["get_invoice"],
  });
  const outcome = await probe.run();

  expect([outcome.endedByTool, probe.executed]).toEqual([undefined, []]);
  expect(probe.modelCalls[1]?.tools.map(tool => tool.name)).toEqual(["get_invoice"]);
});
