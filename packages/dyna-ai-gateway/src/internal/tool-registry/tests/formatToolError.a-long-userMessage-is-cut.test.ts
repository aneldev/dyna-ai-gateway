import {dynaError} from "dyna-error";

import {
  MAX_TOOL_ERROR_USER_MESSAGE_CHARS,
  formatToolError,
} from "../formatToolError";

/** The success output's cap does not apply to an error: a `userMessage` longer than the limit is cut and marked. */
test("formatToolError cuts a userMessage over the limit and marks the cut", () => {
  const error = dynaError({
    code: 5377210486153,
    status: 502,
    message: "A library inside the tool failed",
    userMessage: "x".repeat(10_000),
  });

  const text = formatToolError(error);

  expect(text).toBe(`code: 5377210486153, status: 502, userMessage: ${"x".repeat(MAX_TOOL_ERROR_USER_MESSAGE_CHARS)} [cut]`);
});
