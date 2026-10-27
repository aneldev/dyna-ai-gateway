import {z} from "zod";

import {
  IAIGatewayConfig,
  IToolCallPart,
  ITurn,
  EPartKind,
  defineTool,
  EToolCallVerdict,
} from "../../..";

import {
  IGatewaySetup,
  makeGateway,
} from "./makeGateway";

export interface IToolGatewaySetup extends IGatewaySetup {
  /** The input of every tool execution, by tool name, in order. */
  executions: Array<{name: string; input: unknown; userId: string; threadId: string}>;
}

/** A gateway whose profile `default` may use get_invoice (runs directly) and refund (needs approval). */
export const makeToolGateway = async (configOverrides: Partial<IAIGatewayConfig> = {}): Promise<IToolGatewaySetup> => {
  const executions: IToolGatewaySetup["executions"] = [];
  const makeTool = (name: string, pauses: boolean, output: unknown): ReturnType<typeof defineTool<{invoiceId: string}, unknown>> =>
    defineTool({
      name,
      description: `Tool ${name}`,
      inputSchema: z.object({invoiceId: z.string()}),
      tags: [],
      policy: pauses ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW,
      execute: async ({
        input,
        userContext,
        threadId,
      }): Promise<unknown> => {
        executions.push({
          name,
          input,
          userId: userContext.userId,
          threadId,
        });
        return output;
      },
    });

  const setup = await makeGateway(
    {
      ...configOverrides,
      toolRegistry: {tools: [makeTool("get_invoice", false, {total: 30}), makeTool("refund", true, {refunded: true})]},
    },
    ["get_invoice", "refund"],
  );
  return {
    ...setup,
    executions,
  };
};

export const makeCall = (toolName: string, invoiceId = "4521"): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId: `call-${toolName}`,
  toolName,
  input: {invoiceId},
});

export const loadTurns = (setup: IGatewaySetup, threadId: string): Promise<ITurn[]> =>
  setup.config.threadStore.repository.loadTurns({
    tenantId: "tenant-a",
    threadId,
    desc: false,
    skip: 0,
    limit: 100,
  });
