import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** Step-level (D87, as D86): a denial is one result among the step's; the calls before and after it run as requested. */
test("the other calls of the same step still run when one of them is denied", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("log_event"), makeCall("get_invoice"), makeCall("log_event", "call-log-2")]},
      {text: "Done."},
    ],
    denied: {get_invoice: "Not yours."},
  });
  await probe.run();

  expect(probe.executed).toEqual(["log_event", "log_event"]);
});
