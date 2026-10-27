import {z} from "zod";

import {ToolRegistry} from "../ToolRegistry";
import {defineTool} from "../defineTool";

describe("defineTool", () => {
  test("returns the tool definition unchanged", () => {
    const definition = {
      name: "get_invoice",
      description: "Gets an invoice",
      inputSchema: z.object({id: z.string()}),
      tags: [],
      execute: async (): Promise<number> => 30,
    };
    expect(defineTool(definition)).toBe(definition);
  });

  test("types the input of execute from the inputSchema", async () => {
    const tool = defineTool({
      name: "get_invoice",
      description: "Gets an invoice",
      inputSchema: z.object({id: z.string()}),
      tags: [],
      // Compiles without a cast: `input` is {id: string}
      execute: async ({input}): Promise<string> => input.id.toUpperCase(),
    });
    const registry = new ToolRegistry({tools: [tool]});
    expect(await registry.execute({
      name: "get_invoice",
      input: {id: "inv-1"},
      userContext: {
        tenantId: "tenant-a",
        userId: "user-a",
        permissions: [],
        locale: "de-AT",
        timezone: "Europe/Vienna",
        now: new Date(1_000),
      },
      threadId: "thread-1",
    })).toBe("INV-1");
  });
});
