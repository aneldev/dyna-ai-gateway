import {ELLMClientEventKind} from "../types";
import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** `endsRun` is asked only after a tool executed (D86); a denied terminal tool (D87) did not, so the loop goes on with tools. */
test("a denied terminal tool does not end the run: the next step still offers tools and nothing announces an end", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("handover")]},
      {text: "Still here."},
    ],
    denied: {handover: "Hand-overs are closed at night."},
  });
  const outcome = await probe.run();

  expect([outcome.endedByTool, probe.modelCalls[1]?.tools.length]).toEqual([undefined, 3]);
  expect(probe.eventKinds()).not.toContain(ELLMClientEventKind.RUN_ENDED_BY_TOOL);
});
