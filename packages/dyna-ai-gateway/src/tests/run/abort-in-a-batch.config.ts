import {z} from "zod";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The "stop" button of the test: `hang_until_stopped` presses it once `log_event` has finished. */
export const abortController = new AbortController();

let quickToolDone = false;

/** Answers at once and lets the hanging sibling know it is done. */
export const logEventTool = defineTool({
  name: "log_event",
  description: "Logs an event.",
  inputSchema: z.object({name: z.string()}),
  tags: ["test"],
  execute: async (): Promise<{logged: true}> => {
    quickToolDone = true;
    return {logged: true};
  },
});

/** Waits for its sibling to finish, then presses "stop" and never returns: the call the abort cuts. */
export const hangUntilStoppedTool = defineTool({
  name: "hang_until_stopped",
  description: "Hangs until the call is stopped.",
  inputSchema: z.object({}),
  tags: ["test"],
  execute: async ({abortSignal}): Promise<never> => {
    while (!quickToolDone) await new Promise(resolve => setTimeout(resolve, 5));
    abortController.abort();
    return new Promise<never>((_resolve, reject) => {
      if (abortSignal.aborted) reject(abortSignal.reason);
      abortSignal.addEventListener("abort", () => reject(abortSignal.reason), {once: true});
    });
  },
});

/** A quick tool and a hanging one in the same step, on a parallel profile: the batch an abort cuts in the middle (D101, D90). */
export const gatewayConfigAbortInABatch: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [logEventTool.name, hangUntilStoppedTool.name],
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      logEventTool,
      hangUntilStoppedTool,
    ],
  },
};
