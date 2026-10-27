import {z} from "zod";
import {dynaError} from "dyna-error";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The code of the tool's own error; the model reads it, and the stored result carries it as `errorCode`. */
export const CHARGE_FAILURE_CODE = 5375185962817;
/** What the tool tells the model and, through it, the user: safe, and says how to proceed. */
export const CHARGE_FAILURE_USER_MESSAGE = "The card was declined by the payment provider; ask the customer for another card.";
/** For the developer only: never reaches the model. */
export const CHARGE_FAILURE_MESSAGE = "Payment provider acme-pay at 10.0.4.12 answered 402 for merchant m_8841";

/** Read-only for the policy (no approval), but its service fails on every call: the tool throws a `dynaError` with a `userMessage`. */
export const chargeCardTool = defineTool({
  name: "charge_card",
  description: "Charges the customer's card.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  execute: async ({input: {amount}}): Promise<{charged: number}> => {
    throw dynaError({
      code: CHARGE_FAILURE_CODE,
      status: 402,
      message: CHARGE_FAILURE_MESSAGE,
      userMessage: CHARGE_FAILURE_USER_MESSAGE,
      data: {amount},
    });
  },
});

/** One tool that throws; the profile allows it. */
export const gatewayConfigThrowingTool: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [chargeCardTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [chargeCardTool]},
};
