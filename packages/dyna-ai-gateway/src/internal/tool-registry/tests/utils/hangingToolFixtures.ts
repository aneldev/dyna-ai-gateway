import {z} from "zod";

import {
  IToolDef,
  IUserContext,
} from "../../../../contracts";

/** What a hanging tool saw: its signal, and when it was aborted. */
export interface IHangingToolSeen {
  signal?: AbortSignal;
  abortedAt?: number;
}

export const userContext: IUserContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  permissions: [],
  locale: "de-AT",
  timezone: "Europe/Vienna",
  now: new Date(1_000),
};

/** A tool that answers only when its signal lets it: it resolves on abort with what it saw. */
export const makeHangingTool = (seen: IHangingToolSeen): IToolDef => ({
  name: "slow_lookup",
  description: "Hangs until aborted",
  inputSchema: z.object({id: z.string()}),
  tags: [],
  execute: ({abortSignal}): Promise<unknown> => new Promise(resolve => {
    seen.signal = abortSignal;
    abortSignal.addEventListener("abort", () => {
      seen.abortedAt = Date.now();
      resolve({late: true});
    });
  }),
});
