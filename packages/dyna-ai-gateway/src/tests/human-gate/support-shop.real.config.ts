import {z} from "zod";
import {dynaError} from "dyna-error";

import {
  IAIGatewayConfig,
  IAIProfile,
  IIssue,
  IInputRule,
  EIssueSeverity,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
  EToolCallVerdict,
  TToolCallPolicyResult,
  defineTool,
} from "../..";

import {
  anthropicModel,
  openAiModel,
} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * Scenario "support of Northwind Shop": a support assistant with a tiny in-memory "database" of the customer's orders and four
 * tools. `list_orders` and `verify_customer` are read-only and run directly; `refund_order` has a side effect and pauses the run
 * for a human when the amount is above the approval threshold; `handover_to_agent` ends the run (D86): once a human has the case
 * the assistant only says goodbye. User questions are on, so an ambiguous request pauses with a
 * question instead of a guess, and a refund above the verification threshold makes the model ask the customer for the postcode
 * of the delivery address and verify it before it refunds; the refund tool refuses an unverified thread, so the step cannot be
 * skipped. One guardrail: a prompt (or a typed answer) that carries a card or account number is refused before any model call.
 * Two models: the profile `default` runs on OpenAI, the profile `anthropic` on Anthropic; a call picks one with `profileId`, so the
 * sandbox can switch models (`useProfile("anthropic")` in the dev-tools helpers), and a paused run can resume on the other.
 * The scenario shows every kind of human gate in one story; `support-shop.real.config.readme.md` describes what it offers, the
 * use cases and how to replay them in the sandbox. Tests: `support-shop--*.test.ts` / `*.real.test.ts`, one behaviour each.
 */

//#region "Vars"

/** The threads whose customer has been verified, by `verify_customer`. Per config load, like `ordersDb`. */
const verifiedThreads = new Set<string>();

//#endregion "Vars"

//#region "Settings"

/** A refund above this amount (EUR) pauses the run for a human's approval; at or below it runs directly. */
export const REFUND_APPROVAL_THRESHOLD = 50;

/** A refund above this amount (EUR) needs the customer verified first (`verify_customer` on this thread); at or below it does not. */
export const CUSTOMER_VERIFICATION_THRESHOLD = 10;

/** The postcode of the delivery address of every order: what a customer answers to be verified. */
export const CUSTOMER_POSTCODE = "1010";

//#endregion "Settings"

//#region "Database"

export interface IOrder {
  orderId: string;
  item: string;
  /** EUR. */
  total: number;
  status: "shipped" | "delivered" | "refunded";
  /** Postcode of the delivery address: what the customer is asked to prove it is them. */
  postcode: string;
}

/** The "database": the orders of the logged-in customer. Created fresh per config load; a refund mutates the status. */
export const ordersDb: IOrder[] = [
  {
    orderId: "1001",
    item: "Wireless headphones",
    total: 89,
    status: "delivered",
    postcode: CUSTOMER_POSTCODE,
  },
  {
    orderId: "1002",
    item: "Phone case",
    total: 19,
    status: "delivered",
    postcode: CUSTOMER_POSTCODE,
  },
  {
    orderId: "1003",
    item: "27-inch monitor",
    total: 349,
    status: "shipped",
    postcode: CUSTOMER_POSTCODE,
  },
];

//#endregion "Database"

//#region "Tools"

/** Read only: the model calls it without approval. Returns the orders as objects, so the model can list or tabulate them. */
export const listOrdersTool = defineTool({
  name: "list_orders",
  description: "Lists the orders of the logged-in customer with order id, item, total in EUR and status. Call it before answering about orders or refunding.",
  inputSchema: z.object({}),
  tags: ["orders"],
  execute: (): Promise<Array<Omit<IOrder, "postcode">>> =>
    Promise.resolve(
      ordersDb.map(order => ({
        orderId: order.orderId,
        item: order.item,
        total: order.total,
        status: order.status,
      })),
    ),
});

export interface IVerifyCustomerOutput {
  orderId: string;
  verified: boolean;
}

/**
 * Read only, runs directly: compares the postcode the customer gave with the delivery address of the order. A match marks the
 * thread verified, which `refund_order` requires above `CUSTOMER_VERIFICATION_THRESHOLD`. The postcode itself is never returned.
 */
export const verifyCustomerTool = defineTool({
  name: "verify_customer",
  description: [
    "Verifies the customer against one order by the postcode of its delivery address.",
    "Required before a refund above the verification threshold; ask the customer for the postcode first.",
  ].join(" "),
  inputSchema: z.object({
    orderId: z.string().describe("The order id, e.g. 1003"),
    postcode: z.string().describe("The postcode the customer gave"),
  }),
  tags: ["orders", "security"],
  execute: async ({
    input: {
      orderId,
      postcode,
    },
    threadId,
  }): Promise<IVerifyCustomerOutput> => {
    const order = ordersDb.find(candidate => candidate.orderId === orderId);
    const verified = !!order && order.postcode === postcode.trim();
    if (verified) verifiedThreads.add(threadId);
    return {
      orderId,
      verified,
    };
  },
});

export interface IRefundOrderOutput {
  orderId: string;
  /** EUR. */
  refunded: number;
  status: IOrder["status"];
}

/**
 * Side effect: pauses the run for approval when the amount is above `REFUND_APPROVAL_THRESHOLD`; a small refund runs directly.
 * Above `CUSTOMER_VERIFICATION_THRESHOLD` it refuses a thread `verify_customer` has not verified (a 403 the model reads as a tool
 * error telling it to verify first). Marks the order refunded in the "database". The rejection text tells the model what a
 * declined refund means for the customer.
 */
export const refundOrderTool = defineTool({
  name: "refund_order",
  description: "Refunds an amount in EUR on one order of the customer. Call it for every refund the customer asks for.",
  inputSchema: z.object({
    orderId: z.string().describe("The order id, e.g. 1003"),
    amount: z.number().describe("EUR to refund, as a number"),
    reason: z.string().describe("Why the customer asks for the refund, in a few words"),
  }),
  tags: ["orders", "billing"],
  policy: ({input}): TToolCallPolicyResult =>
    input.amount > REFUND_APPROVAL_THRESHOLD
      ? {
        verdict: EToolCallVerdict.NEEDS_APPROVAL,
        rejectionText: [
          `The support agent declined the refund of ${input.amount} EUR for order ${input.orderId}; nothing was refunded. Tell the customer it was not done, pass on the agent's reason, `,
          "and offer to escalate to a supervisor. Do not call refund_order again for this order unless the customer asks.",
        ].join(" "),
      }
      : {verdict: EToolCallVerdict.ALLOW},
  execute: async ({
    input: {
      orderId,
      amount,
    },
    threadId,
  }): Promise<IRefundOrderOutput> => {
    const order = ordersDb.find(candidate => candidate.orderId === orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (amount > CUSTOMER_VERIFICATION_THRESHOLD && !verifiedThreads.has(threadId)) {
      throw dynaError({
        code: 5375640091512,
        status: 403,
        message: `refund_order: refund of ${amount} EUR on order [${orderId}] refused, the customer of the thread is not verified`,
        userMessage: `Customer verification required for a refund above ${CUSTOMER_VERIFICATION_THRESHOLD} EUR: ask the customer for the postcode of the delivery address and call verify_customer first. Nothing was refunded.`,
        data: {
          orderId,
          amount,
        },
      });
    }
    order.status = "refunded";
    return {
      orderId,
      refunded: amount,
      status: order.status,
    };
  },
});

export interface IHandoverToAgentOutput {
  ticketId: string;
  status: "handed_over";
}

/**
 * Side effect, no approval: opens a ticket for a human agent. Terminal by nature (`endsRun: true`, D86): after it the model gets
 * one last step without tools to tell the customer a colleague takes over, and the answer carries `endedByTool`.
 */
export const handoverToAgentTool = defineTool({
  name: "handover_to_agent",
  description: "Hands the conversation over to a human support agent. Call it when the customer asks for a human, an agent or a person.",
  inputSchema: z.object({reason: z.string().describe("Why the customer wants a human, in a few words")}),
  tags: ["support"],
  endsRun: true,
  execute: async (): Promise<IHandoverToAgentOutput> => ({
    ticketId: "T-1",
    status: "handed_over",
  }),
});

//#endregion "Tools"


//#region "Guardrails"

/**
 * Guardrail: a support chat never holds card or account numbers. Deterministic, no model call: the prompt is refused before the
 * model runs and is not stored. The same rule screens the free text of an answer to a user question (D71).
 */
export const noPaymentDataRule: IInputRule = {
  name: "no_payment_data",
  check: async ({evidence: {prompt}}): Promise<IIssue[]> => {
    //#region "Utils"
    /** Every run of 13 to 19 digits, spaces or dashes allowed between them: a card number candidate, confirmed by Luhn. */
    const CARD_NUMBER_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

    /** An IBAN: two letters, two check digits, 11 to 30 alphanumerics, spaces allowed. */
    const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/;

    /** True when `digits` pass the Luhn check: what tells a card number from a phone number or an order id. */
    const isLuhnValid = (digits: string): boolean => {
      let sum = 0;
      let double = false;
      for (let index = digits.length - 1; index >= 0; index--) {
        let digit = Number(digits[index]);
        if (double) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
        double = !double;
      }
      return sum % 10 === 0;
    };

    /** True when the text carries a card number (a 13 to 19 digit run that passes Luhn) or an IBAN. */
    const containsPaymentData = (text: string): boolean =>
      IBAN.test(text)
      || (text.match(CARD_NUMBER_CANDIDATE) ?? []).some(candidate => isLuhnValid(candidate.replace(/[ -]/g, "")));

    //#endregion "Utils"

    return containsPaymentData(prompt)
      ? [{
        code: "payment_data_in_chat",
        message: "Please do not share card or account numbers in the chat. Refunds always go to the payment method of the order.",
        severity: EIssueSeverity.ERROR,
        field: "prompt",
      }]
      : [];
  },
};

//#endregion "Guardrails"

//#region "Gateway config"

/** The profile the tests run on: OpenAI, the three tools, the addendum that leaves the model one path per situation. */
const supportShopDefaultProfile: IAIProfile = {
  ...sampleProfile,
  promptAddendum: [
    "You are the support assistant of Northwind Shop; the customer is logged in. Be short and friendly.",
    "Call list_orders before answering about orders or refunding.",

    "For every refund the customer asks for you MUST call refund_order with the order id and the amount as a number;",
    "never ask for confirmation in text, the system handles approvals. The result of refund_order is final: report the amount it",
    "returned even when it differs from what was asked; do not refund the difference and do not ask about it.",

    `Before a refund above ${CUSTOMER_VERIFICATION_THRESHOLD} EUR you MUST verify the customer once per conversation: ask with ask_user_question`,
    "(one free-text question) for the postcode of the order's delivery address, then call verify_customer. Refund only when it",
    "returns verified true; when false, tell the customer the postcode did not match and do not refund. A refund of",
    `${CUSTOMER_VERIFICATION_THRESHOLD} EUR or less needs no verification. Never reveal the postcode.`,

    "An order is identified when the customer names its id or its item (the monitor is order 1003). When a refund request fits",
    "more than one order or none, you MUST call ask_user_question with the orders as options; never guess and never ask in",
    "plain text. Ask only which order: unless the customer says otherwise, refund the order's full total and use what the",
    "customer said as the reason (or 'customer request' when nothing was said).",

    "When the customer asks for a human, an agent or a person, call handover_to_agent with the reason; then only tell the",
    "customer that a colleague takes over, in one sentence.",
  ].join(" "),
  allowedTools: [
    listOrdersTool.name,
    verifyCustomerTool.name,
    refundOrderTool.name,
    handoverToAgentTool.name,
  ],
};

/** The same assistant on Anthropic: `profileId: "anthropic"` on a call, or on a `resume` to swap the model mid-run (D65). */
const supportShopAnthropicProfile: IAIProfile = {
  ...supportShopDefaultProfile,
  id: "anthropic",
  name: "Support shop on Anthropic",
  modelId: anthropicModel.id,
};

export const gatewayConfigSupportShop: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {
    repository: new InMemoryModelRegistryRepository({
      models: [
        openAiModel,
        anthropicModel,
      ],
    }),
  },
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        supportShopDefaultProfile,
        supportShopAnthropicProfile,
      ],
    }),
  },
  toolRegistry: {
    tools: [
      listOrdersTool,
      verifyCustomerTool,
      refundOrderTool,
      handoverToAgentTool,
    ],
  },
  humanGate: {userQuestions: {enabled: true}},
  guardrails: {inputRules: [noPaymentDataRule]},
};


//#endregion "Gateway config"
