import {
  DEFAULT_TOOL_REJECTION_TEXT,
  EPartKind,
} from "../../../contracts";

import {EMessageRole} from "../types";
import {toSdkMessages} from "../utils/toSdkMessages";

/** The converter needs no tool definitions: a rejected part holds its text; one without any gets the default lead, never an empty result. */
test("a rejected tool result without a text is sent as execution-denied with the default rejection text", () => {
  const [message] = toSdkMessages([{
    role: EMessageRole.TOOL,
    parts: [{
      kind: EPartKind.TOOL_RESULT,
      callId: "call-1",
      toolName: "refund",
      output: "   ",
      rejected: true,
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
        reason: DEFAULT_TOOL_REJECTION_TEXT,
      },
    }],
  });
});
