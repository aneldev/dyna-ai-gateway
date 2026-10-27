import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";
import {makeTimeoutError} from "../internal/utils/makeTimeoutError";

/**
 * The signals the hanging tool received (the proof that the call's deadline reached the tool), and the deadline a test stands in
 * for `AbortSignal.timeout`: the tool fires it the moment it starts, so the deadline passes inside the tool without a clock.
 */
export const hangingToolCalls: {
  signals: AbortSignal[];
  deadline?: AbortController;
} = {signals: []};

/** Read-only for the policy (no approval); never answers on its own: it waits until its signal is aborted, then gives up. */
export const waitForeverTool = defineTool({
  name: "wait_forever",
  description: "Waits for an external system that never answers.",
  inputSchema: z.object({}),
  tags: ["test"],
  execute: ({abortSignal}): Promise<never> => new Promise((_resolve, reject) => {
    hangingToolCalls.signals.push(abortSignal);
    abortSignal.addEventListener("abort", () => reject(abortSignal.reason), {once: true});
    hangingToolCalls.deadline?.abort(makeTimeoutError());
  }),
});

/** One tool that hangs; the profile allows it. */
export const gatewayConfigHangingTool: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [waitForeverTool.name],
        },
      ],
    }),
  },
  toolRegistry: {tools: [waitForeverTool]},
};
