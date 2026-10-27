import {z} from "zod";

import {
  IToolDef,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../contracts";

import {runAgentLoop} from "../runAgentLoop";
import {
  ILLMClientHooks,
  IModelResult,
  ERunOutcomeStatus,
} from "../types";
import {
  makeCall,
  makeResult,
  request,
} from "./utils/runAgentLoopFixtures";

/** The tool of the step: only an offered tool is decided on by the policy (D79). */
const refundTool: IToolDef = {
  name: "refund",
  description: "Refunds an amount.",
  inputSchema: z.object({}),
  tags: [],
  execute: async (): Promise<unknown> => ({ok: true}),
};

/**
 * The caller aborts while the policy decides on a call (the hook takes no signal) and the verdict is NEEDS_APPROVAL: the loop
 * does not pause a run nobody waits for; it returns ABORTED, the call left without a result.
 */
test("an abort while the policy decides to pause ends the loop ABORTED, not PAUSED", async () => {
  const controller = new AbortController();
  const hooks: ILLMClientHooks = {
    executeTool: async (): Promise<unknown> => ({ok: true}),
    decideToolCall: async (): Promise<TToolCallPolicyResult> => {
      controller.abort(new Error("stop pressed"));
      return {verdict: EToolCallVerdict.NEEDS_APPROVAL};
    },
    prepareStep: (): IToolDef[] => [refundTool],
    endsRun: (): boolean => false,
    onEvent: (): void => undefined,
  };

  const outcome = await runAgentLoop({
    request,
    hooks,
    limits: {maxSteps: 3},
    abortSignal: controller.signal,
    callModel: async (): Promise<IModelResult> => makeResult(0, [makeCall("refund")]),
  });

  expect([outcome.status, outcome.pendingCalls]).toEqual([ERunOutcomeStatus.ABORTED, undefined]);
});
