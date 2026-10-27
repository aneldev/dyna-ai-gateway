import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** A denied tool unlocks nothing (D76): the next step's `executed` leaves it out, so a tool that `requires` it stays hidden. */
test("a denied call does not count as executed for the next step", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("get_invoice"), makeCall("log_event")]},
      {text: "Done."},
    ],
    denied: {get_invoice: "Not yours."},
  });
  await probe.run();

  expect(probe.stepExecuted).toEqual([[], ["log_event"]]);
});
