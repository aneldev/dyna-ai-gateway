import {EPartKind} from "../../../contracts";

import {EMessageRole} from "../types";
import {toSdkMessages} from "../utils/toSdkMessages";

/** The provider reads a denial (D87) like a human's rejection: an `execution-denied` output whose reason is the stored text. */
test("a denied tool result travels to the SDK as execution-denied with the stored text as the reason", () => {
  const [message] = toSdkMessages([{
    role: EMessageRole.TOOL,
    parts: [{
      kind: EPartKind.TOOL_RESULT,
      callId: "call-1",
      toolName: "refund",
      output: "Refused. Reason: above the charge.",
      denied: true,
    }],
  }]);

  expect(message).toEqual({
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call-1",
      toolName: "refund",
      output: {
        type: "execution-denied",
        reason: "Refused. Reason: above the charge.",
      },
    }],
  });
});
