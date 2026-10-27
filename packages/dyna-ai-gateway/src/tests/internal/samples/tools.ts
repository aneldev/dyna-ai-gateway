import {z} from "zod";

import {
  defineTool,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../..";

/** Read-only: the model may call it without approval. */
export const getCurrentTimeTool = defineTool({
  name: "get_current_time",
  description: "Returns the current date and time. Call it when the user asks what time or day it is.",
  inputSchema: z.object({
    timezone: z.string().optional()
      .describe("IANA zone, e.g. Europe/Vienna; omit for UTC"),
  }),
  tags: ["time"],
  execute: async ({
    input,
    userContext,
  }): Promise<{iso: string; timezone: string}> => {
    const timezone = input.timezone ?? userContext.timezone;
    return {
      iso: new Date().toLocaleString("sv-SE", {timeZone: timezone}),
      timezone,
    };
  },
});

/** Pauses the run for approval on every call. Sends nothing, it only pretends to. */
export const sendEmailTool = defineTool({
  name: "send_email",
  description: "Sends an email. Call it when the user asks to send, mail or forward something to someone.",
  inputSchema: z.object({
    to: z.string().describe("Recipient address"),
    subject: z.string(),
    body: z.string(),
  }),
  tags: ["email"],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async ({input}): Promise<{sent: boolean; to: string; messageId: string}> => ({
    sent: true,
    to: input.to,
    messageId: `msg-${Date.now()}`,
  }),
});

interface IRefundOutput {
  refunded: number;
}

export const refundTool = defineTool({
  name: "refund",
  description: "Refunds an amount to the customer.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  policy: ({input}): TToolCallPolicyResult => ({verdict: input.amount >= 100 ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW}),
  execute: async ({input: {amount}}): Promise<IRefundOutput> => {
    return {refunded: amount};
  },
});
