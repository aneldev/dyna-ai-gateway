import {z} from "zod";
import {dynaError} from "dyna-error";

import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The order in which the two tools started and finished: `<tool>:start` / `<tool>:end`. */
export const toolLog: string[] = [];

let releaseWaiting: (() => void) | null = null;

/** Waits until `release_waiting` ran in the same step; fails after 2 s, so a loop that runs the calls one after the other fails fast instead of hanging. */
export const waitForSiblingTool = defineTool({
  name: "wait_for_sibling",
  description: "Returns once its sibling tool of the same step has run.",
  inputSchema: z.object({}),
  tags: ["test"],
  execute: async (): Promise<{released: boolean}> => {
    toolLog.push("wait_for_sibling:start");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(dynaError({
        code: 5376561294743,
        message: "wait_for_sibling: the sibling never ran while this call waited; the calls did not run concurrently",
      })), 2000);
      releaseWaiting = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });
    toolLog.push("wait_for_sibling:end");
    return {released: true};
  },
});

/** Releases `wait_for_sibling`; the second call of the step, so it can only finish first when the two overlap. */
export const releaseSiblingTool = defineTool({
  name: "release_sibling",
  description: "Lets the waiting sibling tool of the same step finish.",
  inputSchema: z.object({}),
  tags: ["test"],
  execute: async (): Promise<{released: boolean}> => {
    toolLog.push("release_sibling:start");
    releaseWaiting?.();
    toolLog.push("release_sibling:end");
    return {released: true};
  },
});

/** Two tools that only complete when they run at the same time: the proof of a concurrent step (D101). */
export const gatewayConfigConcurrentTools: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [
        {
          ...sampleProfile,
          allowedTools: [waitForSiblingTool.name, releaseSiblingTool.name],
        },
      ],
    }),
  },
  toolRegistry: {
    tools: [
      waitForSiblingTool,
      releaseSiblingTool,
    ],
  },
};
