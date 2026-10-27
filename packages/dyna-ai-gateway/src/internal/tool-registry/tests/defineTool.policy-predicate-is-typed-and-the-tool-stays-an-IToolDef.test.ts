import {z} from "zod";

import {
  EToolCallVerdict,
  IToolDef,
  TToolCallPolicyResult,
} from "../../../contracts";

import {defineTool} from "../defineTool";

describe("defineTool", () => {
  test("types the policy predicate from the inputSchema, and the tool still assigns to IToolDef", async () => {
    const tool = defineTool({
      name: "refund",
      description: "Refunds an amount",
      inputSchema: z.object({amount: z.number()}),
      tags: [],
      // Compiles without a cast: `input` is {amount: number}
      policy: ({input}): TToolCallPolicyResult => input.amount > 100
        ? {
          verdict: EToolCallVerdict.DENY,
          reason: `${input.amount} is too much.`,
        }
        : {verdict: EToolCallVerdict.ALLOW},
      execute: async ({input}): Promise<{refunded: number}> => ({refunded: input.amount}),
    });

    // The bivariance trick (D87): a typed tool is still a plain IToolDef
    const untyped: IToolDef = tool;
    expect(untyped.policy).toBe(tool.policy);
    if (typeof tool.policy !== "function") throw new Error("policy should be the predicate");
    expect(await tool.policy({
      input: {amount: 500},
      userContext: {
        tenantId: "tenant-a",
        userId: "user-a",
        permissions: [],
        locale: "de-AT",
        timezone: "Europe/Vienna",
        now: new Date(1_000),
      },
    })).toEqual({
      verdict: EToolCallVerdict.DENY,
      reason: "500 is too much.",
    });
  });
});
