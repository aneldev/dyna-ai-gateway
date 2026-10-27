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
 * The caller aborts after the first step answered with a tool request. The tool ran; the loop then checks the signal before
 * the next model call and returns ABORTED with the step on record (the tool call and its result): the second model call never happens.
 */
test("an abort between two steps ends the loop ABORTED before the next model call, the executed tool on record", async () => {
  const controller = new AbortController();
  const modelCalls: number[] = [];
  const hooks: ILLMClientHooks = {
    executeTool: async (): Promise<unknown> => {
      controller.abort(new Error("stop pressed"));
      return {ok: true};
    },
    decideToolCall: (): TToolCallPolicyResult => ({verdict: EToolCallVerdict.ALLOW}),
    prepareStep: (): IToolDef[] => [],
    endsRun: (): boolean => false,
    onEvent: (): void => undefined,
  };
  const script = [makeResult(0, [makeCall("get_invoice")]), makeResult(1, [], "done")];

  const outcome = await runAgentLoop({
    request,
    hooks,
    limits: {maxSteps: 3},
    abortSignal: controller.signal,
    callModel: async ({stepIndex}): Promise<IModelResult> => {
      modelCalls.push(stepIndex);
      return script[stepIndex] ?? makeResult(stepIndex, [], "done");
    },
  });

  expect([
    outcome.status,
    outcome.result,
    outcome.messages.map(message => [message.role, message.parts.map(part => part.kind)]),
    modelCalls,
  ]).toEqual([
    ERunOutcomeStatus.ABORTED,
    undefined,
    [[ETurnRole.ASSISTANT, [EPartKind.TOOL_CALL]], [ETurnRole.TOOL, [EPartKind.TOOL_RESULT]]],
    [0],
  ]);
});
