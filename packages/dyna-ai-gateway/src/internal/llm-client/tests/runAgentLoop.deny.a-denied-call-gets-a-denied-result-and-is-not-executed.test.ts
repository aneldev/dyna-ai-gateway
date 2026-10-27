import {
  DEFAULT_TOOL_DENIAL_TEXT,
  EPartKind,
} from "../../../contracts";

import {ELLMClientEventKind} from "../types";
import {
  makeCall,
  makeLoopProbe,
} from "./utils/runAgentLoopFixtures";

/** A denied call (D87) never executes; its result is the fixed lead plus the policy's reason, flagged `denied`, and streams as a TOOL_RESULT. */
test("a call the policy denies gets a denied result with the lead text and the reason, and the tool is not executed", async () => {
  const probe = makeLoopProbe({
    script: [
      {toolCalls: [makeCall("get_invoice")]},
      {text: "I cannot do that."},
    ],
    denied: {get_invoice: "The invoice belongs to another customer."},
  });
  const outcome = await probe.run();

  const results = outcome.messages.flatMap(message => message.parts.filter(part => part.kind === EPartKind.TOOL_RESULT));
  expect(results).toEqual([{
    kind: EPartKind.TOOL_RESULT,
    callId: "call-get_invoice",
    toolName: "get_invoice",
    output: `${DEFAULT_TOOL_DENIAL_TEXT} Reason: The invoice belongs to another customer.`,
    denied: true,
  }]);
  expect(probe.executed).toEqual([]);
  const resultEvent = probe.events.find(event => event.kind === ELLMClientEventKind.TOOL_RESULT);
  expect(resultEvent?.toolOutput).toBe(results[0]?.output);
  expect(outcome.result?.text).toBe("I cannot do that.");
});
