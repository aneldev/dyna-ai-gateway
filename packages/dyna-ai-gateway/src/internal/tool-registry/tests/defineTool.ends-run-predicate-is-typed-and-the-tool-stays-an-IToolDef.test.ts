import {z} from "zod";

import {IToolDef} from "../../../contracts";

import {defineTool} from "../defineTool";

describe("defineTool", () => {
  test("types the endsRun predicate from the inputSchema and the output, and the tool still assigns to IToolDef", async () => {
    const tool = defineTool({
      name: "handover_to_agent",
      description: "Hands the case to a human agent",
      inputSchema: z.object({reason: z.string()}),
      tags: [],
      execute: async ({input}): Promise<{status: "accepted" | "queued"; reason: string}> => ({
        status: "accepted",
        reason: input.reason,
      }),
      // Compiles without a cast: `input` is {reason: string}, `output` is the execute result
      endsRun: ({
        input,
        output,
      }): boolean => output.status === "accepted" && input.reason.length > 0,
    });

    // The bivariance trick: a typed tool is still a plain IToolDef, like with policy (D87)
    const untyped: IToolDef = tool;
    expect(untyped.endsRun).toBe(tool.endsRun);
    if (typeof tool.endsRun !== "function") throw new Error("endsRun should be the predicate");
    expect(await tool.endsRun({
      input: {reason: "Customer asked for a human"},
      output: {
        status: "accepted",
        reason: "Customer asked for a human",
      },
      userContext: {
        tenantId: "tenant-a",
        userId: "user-a",
        permissions: [],
        locale: "de-AT",
        timezone: "Europe/Vienna",
        now: new Date(1_000),
      },
    })).toBe(true);
  });
});
