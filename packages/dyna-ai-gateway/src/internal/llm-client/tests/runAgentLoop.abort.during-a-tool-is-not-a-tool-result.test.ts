import {
  IToolDef,
  EPartKind,
  EToolCallVerdict,
  TToolCallPolicyResult,
  ETurnRole,
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

/**
 * The caller aborts while a tool runs. The hook rejects with the signal's reason (as ToolRegistry.execute does); the loop
 * must not turn that into a failed tool result the model reads: it returns ABORTED with the call left without a result, and the
 * signal reached the hook.
 */
test("an abort during a tool ends the loop ABORTED with the call unanswered, not with a failed tool result", async () => {
  const controller = new AbortController();
  let seenSignal: AbortSignal | undefined;
  const hooks: ILLMClientHooks = {
    executeTool: ({abortSignal}): Promise<unknown> => new Promise((_resolve, reject) => {
      seenSignal = abortSignal;
      abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
      controller.abort(new Error("stop pressed"));
    }),
    decideToolCall: (): TToolCallPolicyResult => ({verdict: EToolCallVerdict.ALLOW}),
    prepareStep: (): IToolDef[] => [],
    endsRun: (): boolean => false,
    onEvent: (): void => undefined,
  };

  const outcome = await runAgentLoop({
    request,
    hooks,
    limits: {maxSteps: 3},
    abortSignal: controller.signal,
    callModel: async (): Promise<IModelResult> => makeResult(0, [makeCall("get_invoice")]),
  });

  expect([
    outcome.status,
    outcome.messages.map(message => [message.role, message.parts.map(part => part.kind)]),
    seenSignal?.aborted,
  ]).toEqual([
    ERunOutcomeStatus.ABORTED,
    [[ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]]],
    true,
  ]);
});
