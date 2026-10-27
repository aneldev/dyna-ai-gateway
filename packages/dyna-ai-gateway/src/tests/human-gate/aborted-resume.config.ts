import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  EToolCallVerdict,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * The controller of the resume under test; the tool presses "stop" on it when one is set, the moment it starts,
 * with `reason` when a test gives one (a `TimeoutError`, when the controller stands in for `AbortSignal.timeout`).
 */
export const abortedResume: {
  controller?: AbortController;
  reason?: unknown;
} = {};

/**
 * A refund that needs approval and, once approved, waits on a provider that never answers: it gives up only when its signal is
 * aborted. It presses "stop" on `abortedResume.controller` as it starts, so the abort lands while the approved tool runs.
 */
export const slowRefundTool = defineTool({
  name: "refund",
  description: "Refunds an amount to the customer.",
  inputSchema: z.object({amount: z.number()}),
  tags: ["billing"],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: ({abortSignal}): Promise<never> => new Promise((_resolve, reject) => {
    abortSignal.addEventListener("abort", () => reject(abortSignal.reason), {once: true});
    abortedResume.controller?.abort(abortedResume.reason);
  }),
});

/** Registry: the slow refund; the profile allows it. */
export const gatewayConfigAbortedResume: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [slowRefundTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [slowRefundTool]},
};
