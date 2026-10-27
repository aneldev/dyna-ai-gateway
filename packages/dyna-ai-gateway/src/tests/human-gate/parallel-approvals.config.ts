import {z} from "zod";

import {
  IAIGatewayConfig,
  IInputRule,
  IIssue,
  InMemoryAIProfileRepository,
  EToolCallVerdict,
  TToolCallPolicyResult,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {
  getCurrentTimeTool,
  refundTool,
} from "../internal/samples/tools";
import {
  gatewayConfigParallelTools,
  lookupOrderTool,
} from "../run/parallel-tools.config";

/** What the model reads when the human rejects a cancellation (D87); the test tells it apart from the default text. */
export const CANCEL_REJECTION_TEXT = "The order was not cancelled.";

/** How many times the cancellation ran: the proof that a refused resume or an expiry runs nothing. */
export const cancelExecutions = {count: 0};

/** How many times the input rules ran: on the prompt of a run, and on the free text of an answer (D71). */
export const answerScreenings = {count: 0};

/** Pauses on every call, with its own rejection text: the second approval tool of a step. */
export const cancelOrderTool = defineTool({
  name: "cancel_order",
  description: "Cancels the order of the given id.",
  inputSchema: z.object({orderId: z.string()}),
  tags: ["orders"],
  policy: (): TToolCallPolicyResult => ({
    verdict: EToolCallVerdict.NEEDS_APPROVAL,
    rejectionText: CANCEL_REJECTION_TEXT,
  }),
  execute: async ({input: {orderId}}): Promise<{cancelled: string}> => {
    cancelExecutions.count += 1;
    return {cancelled: orderId};
  },
});

/** Lets every text through and counts the screenings: the prompt of a run, and the free text of an answer (D71). */
const countingRule: IInputRule = {
  name: "counting",
  check: async (): Promise<IIssue[]> => {
    answerScreenings.count += 1;
    return [];
  },
};

/** How long a pause of this scenario waits for a human, in ms; the expiry test moves a fake clock past it. */
export const PAUSE_TIMEOUT_MS = 60_000;

const allowedTools = [
  getCurrentTimeTool.name,
  lookupOrderTool.name,
  refundTool.name,
  cancelOrderTool.name,
];

/**
 * The tools of `gatewayConfigParallelTools` plus `cancel_order` (pauses always) and the user question: a model step can hold
 * two approvals, or an approval and a question, back at once (D102). An input rule counts the answer screenings.
 */
export const gatewayConfigParallelApprovals: IAIGatewayConfig = {
  ...gatewayConfigParallelTools,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools,
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      getCurrentTimeTool,
      lookupOrderTool,
      refundTool,
      cancelOrderTool,
    ],
  },
  humanGate: {
    timeoutMs: PAUSE_TIMEOUT_MS,
    userQuestions: {enabled: true},
  },
  guardrails: {inputRules: [countingRule]},
};

/** The same scenario on a profile that runs the calls of a step one after the other (`parallelToolCalls: false`, D101). */
export const gatewayConfigSequentialApprovals: IAIGatewayConfig = {
  ...gatewayConfigParallelApprovals,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools,
          parallelToolCalls: false,
        },
      ],
    }),
  },
};
