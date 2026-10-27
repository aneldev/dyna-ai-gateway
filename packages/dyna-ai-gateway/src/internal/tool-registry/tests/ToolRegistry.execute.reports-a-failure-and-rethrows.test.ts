import {z} from "zod";

import {
  IToolDef,
  IToolErrorReport,
} from "../../../contracts";

import {TOOL_FAILURE_TEXT} from "../formatToolError";
import {ToolRegistry} from "../ToolRegistry";

import {userContext} from "./utils/hangingToolFixtures";

/** A tool whose author caught nothing: a plain `Error` leaves `execute`. */
const brokenTool: IToolDef = {
  name: "broken_lookup",
  description: "Always throws",
  inputSchema: z.object({id: z.string()}),
  tags: [],
  execute: async (): Promise<unknown> => {
    throw new Error("socket hang up");
  },
};

test("ToolRegistry.execute: a failed call is reported to onToolError with the wrapped error and the model's text, then rethrown", async () => {
  const reports: IToolErrorReport[] = [];
  const registry = new ToolRegistry({
    tools: [brokenTool],
    onToolError: (report): void => {
      reports.push(report);
    },
  });
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const thrown: unknown = await registry.execute({
      name: "broken_lookup",
      input: {id: "4711"},
      userContext,
      threadId: "thread-1",
      callContext: {
        callId: "call-7",
        stepIndex: 2,
        runId: "run-9",
      },
    }).then(() => undefined, (error: unknown) => error);

    const [report] = reports;
    expect([
      reports.length,
      report?.error === thrown,
      (thrown as {code?: number; status?: number; parentError?: Error}).code,
      (thrown as {code?: number; status?: number; parentError?: Error}).status,
      (thrown as {code?: number; status?: number; parentError?: Error}).parentError?.message,
      report?.modelText,
      report?.callId,
      report?.stepIndex,
      report?.runId,
      report?.toolName,
      report?.input,
      report?.tenantId,
      report?.threadId,
      errorSpy.mock.calls.length,
    ]).toEqual([
      1,
      true,
      5376189327022,
      500,
      "socket hang up",
      `code: 5376189327022, status: 500, userMessage: ${TOOL_FAILURE_TEXT}`,
      "call-7",
      2,
      "run-9",
      "broken_lookup",
      {id: "4711"},
      userContext.tenantId,
      "thread-1",
      1,
    ]);
  }
  finally {
    errorSpy.mockRestore();
  }
});
