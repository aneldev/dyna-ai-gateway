import {
  IToolCallPart,
  IToolDef,
  EPartKind,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../contracts";

import {runAgentLoop} from "../runAgentLoop";
import {
  ILLMClientHooks,
  IModelRequest,
  IModelResult,
  EFinishReason,
  EMessageRole,
} from "../types";

const request: IModelRequest = {
  modelId: "model-a",
  system: "You are a test",
  messages: [],
  maxOutputTokens: 500,
};

const makeCall = (toolName: string): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId: `call-${toolName}`,
  toolName,
  input: {},
});

const makeResult = (toolCalls: IToolCallPart[], text = ""): IModelResult => ({
  modelId: "model-a",
  text,
  toolCalls,
  finishReason: toolCalls.length > 0 ? EFinishReason.TOOL_CALLS : EFinishReason.STOP,
  usage: {
    inputTokens: 1,
    outputTokens: 1,
  },
  latencyMs: 0,
  traceId: "trace-1",
});

/**
 * One step asks for two tools; the first throws (refused, invalid input, a failing service), the second runs. The next step's
 * `executed` holds the second only, and the first's result is marked `failed` (D76): a tool that did not run unlocks nothing.
 */
test("a tool that throws is not counted as executed and its result is marked failed", async () => {
  const seen: string[][] = [];
  const hooks: ILLMClientHooks = {
    executeTool: async ({call}): Promise<unknown> => {
      if (call.toolName === "refund") throw new Error("not available");
      return {ok: true};
    },
    decideToolCall: (): TToolCallPolicyResult => ({verdict: EToolCallVerdict.ALLOW}),
    prepareStep: ({executed}): IToolDef[] => {
      seen.push([...executed]);
      return [];
    },
    endsRun: (): boolean => false,
    onEvent: (): void => undefined,
  };
  const script = [makeResult([makeCall("refund"), makeCall("get_invoice")]), makeResult([], "done")];

  const outcome = await runAgentLoop({
    request,
    hooks,
    limits: {maxSteps: 3},
    callModel: async ({stepIndex}): Promise<IModelResult> => script[stepIndex] ?? makeResult([], "done"),
  });

  const results = outcome.messages
    .filter(message => message.role === EMessageRole.TOOL)
    .flatMap(message => message.parts)
    .map(part => part.kind === EPartKind.TOOL_RESULT ? [part.toolName, part.failed ?? false] : part.kind);
  expect([seen, results]).toEqual([
    [[], ["get_invoice"]],
    [["refund", true], ["get_invoice", false]],
  ]);
});
