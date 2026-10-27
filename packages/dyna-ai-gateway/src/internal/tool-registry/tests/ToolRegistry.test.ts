import {z} from "zod";

import {
  IToolDef,
  IUserContext,
} from "../../../contracts";

import {ToolRegistry} from "../ToolRegistry";

const userContext: IUserContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  permissions: [],
  locale: "de-AT",
  timezone: "Europe/Vienna",
  now: new Date(1_000),
};

const makeTool = (name: string, overrides: Partial<IToolDef> = {}): IToolDef => ({
  name,
  description: `Tool ${name}`,
  inputSchema: z.object({
    id: z.string(),
    limit: z.number().default(10),
  }),
  tags: [],
  execute: async ({input}): Promise<unknown> => ({received: input}),
  ...overrides,
});

const execute = (registry: ToolRegistry, input: unknown, name = "get_invoice"): Promise<unknown> =>
  registry.execute({
    name,
    input,
    userContext,
    threadId: "thread-1",
  });

describe("ToolRegistry", () => {
  describe("M2 — the tools of the config, get, list", () => {
    test("get returns a tool of the config", () => {
      const tool = makeTool("get_invoice");
      const registry = new ToolRegistry({tools: [tool]});
      expect(registry.get({name: "get_invoice"})).toBe(tool);
    });

    test("list returns the tools in the order of the config", () => {
      const registry = new ToolRegistry({tools: [makeTool("b_tool"), makeTool("a_tool")]});
      expect(registry.list().map(tool => tool.name)).toEqual(["b_tool", "a_tool"]);
    });

    test("the constructor throws a 400 with code 5372567786217 on a duplicate name", () => {
      expect(() => new ToolRegistry({tools: [makeTool("get_invoice"), makeTool("get_invoice")]})).toThrow(expect.objectContaining({
        code: 5372567786217,
        status: 400,
        data: {name: "get_invoice"},
      }));
    });

    test("get throws a 404 with code 5372567786229 for an unknown tool", () => {
      const registry = new ToolRegistry({});
      expect(() => registry.get({name: "missing"})).toThrow(expect.objectContaining({
        code: 5372567786229,
        status: 404,
        data: {name: "missing"},
      }));
    });
  });

  describe("M2 — execute", () => {
    test("returns what the tool returns", async () => {
      const registry = new ToolRegistry({tools: [makeTool("get_invoice", {execute: async (): Promise<unknown> => ({total: 30})})]});
      expect(await execute(registry, {id: "4521"})).toEqual({total: 30});
    });

    test("runs the tool with the input parsed by its schema (defaults applied)", async () => {
      const registry = new ToolRegistry({tools: [makeTool("get_invoice")]});
      expect(await execute(registry, {id: "4521"})).toEqual({
        received: {
          id: "4521",
          limit: 10,
        },
      });
    });

    test("passes the user context and the thread to the tool", async () => {
      const seen: unknown[] = [];
      const registry = new ToolRegistry({
        tools: [makeTool("get_invoice", {
          execute: async ({
            userContext: context, threadId,
          }): Promise<unknown> => seen.push([context.userId, threadId]),
        })],
      });
      await execute(registry, {id: "4521"});
      expect(seen).toEqual([["user-a", "thread-1"]]);
    });

    test("throws a 400 with code 5372567786241 naming the field when the input does not match the schema", async () => {
      const registry = new ToolRegistry({tools: [makeTool("get_invoice")]});
      await expect(execute(registry, {id: 4521})).rejects.toMatchObject({
        code: 5372567786241,
        status: 400,
        data: {
          name: "get_invoice",
          field: "id",
        },
      });
    });

    test("does not run the tool when the input does not match the schema", async () => {
      const run = jest.fn();
      const registry = new ToolRegistry({tools: [makeTool("get_invoice", {execute: run})]});
      await execute(registry, {}).catch(() => undefined);
      expect(run).not.toHaveBeenCalled();
    });

    test("throws the 404 of get for an unknown tool", async () => {
      const registry = new ToolRegistry({});
      await expect(execute(registry, {}, "missing")).rejects.toMatchObject({code: 5372567786229});
    });
  });

  describe("M6.2b — execute: timeout, abort signal, output cap (D60)", () => {
    const silenceConsole = (): jest.SpyInstance => jest.spyOn(console, "error").mockImplementation(() => undefined);

    test("passes an abort signal to the tool that is not aborted while the tool answers in time", async () => {
      let seen: AbortSignal | undefined;
      const registry = new ToolRegistry({
        tools: [makeTool("get_invoice", {
          execute: async ({abortSignal}): Promise<unknown> => {
            seen = abortSignal;
            return {};
          },
        })],
      });
      await execute(registry, {id: "4521"});
      expect(seen?.aborted).toBe(false);
    });

    test("throws a 504 with code 5374403782185, aborts the signal and logs when the tool exceeds toolTimeoutMs", async () => {
      const log = silenceConsole();
      let seen: AbortSignal | undefined;
      const registry = new ToolRegistry({
        toolTimeoutMs: 20,
        tools: [makeTool("get_invoice", {
          execute: ({abortSignal}): Promise<unknown> => new Promise(resolve => {
            seen = abortSignal;
            setTimeout(() => resolve({}), 200);
          }),
        })],
      });
      await expect(execute(registry, {id: "4521"})).rejects.toMatchObject({
        code: 5374403782185,
        status: 504,
        data: {
          name: "get_invoice",
          timeoutMs: 20,
        },
      });
      expect(seen?.aborted).toBe(true);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Internal error 5374403782185"));
      log.mockRestore();
    });

    test("the tool's own timeoutMs wins over toolTimeoutMs", async () => {
      const log = silenceConsole();
      const registry = new ToolRegistry({
        toolTimeoutMs: 20,
        tools: [makeTool("get_invoice", {
          timeoutMs: 500,
          execute: (): Promise<unknown> => new Promise(resolve => setTimeout(() => resolve({total: 30}), 60)),
        })],
      });
      expect(await execute(registry, {id: "4521"})).toEqual({total: 30});
      log.mockRestore();
    });

    test("throws a 413 with code 5374403782197 and logs when the output is larger than maxOutputChars", async () => {
      const log = silenceConsole();
      const registry = new ToolRegistry({
        maxOutputChars: 10,
        tools: [makeTool("get_invoice", {execute: async (): Promise<unknown> => ({text: "x".repeat(20)})})],
      });
      await expect(execute(registry, {id: "4521"})).rejects.toMatchObject({
        code: 5374403782197,
        status: 413,
        data: {
          name: "get_invoice",
          maxOutputChars: 10,
        },
      });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("Internal error 5374403782197"));
      log.mockRestore();
    });

    test("the tool's own maxOutputChars wins over the config's", async () => {
      const registry = new ToolRegistry({
        maxOutputChars: 10,
        tools: [makeTool("get_invoice", {
          maxOutputChars: 100,
          execute: async (): Promise<unknown> => ({text: "x".repeat(20)}),
        })],
      });
      expect(await execute(registry, {id: "4521"})).toEqual({text: "x".repeat(20)});
    });

    test("an undefined output passes the size check", async () => {
      const registry = new ToolRegistry({tools: [makeTool("get_invoice", {execute: async (): Promise<unknown> => undefined})]});
      expect(await execute(registry, {id: "4521"})).toBeUndefined();
    });
  });
});
