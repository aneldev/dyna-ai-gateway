import {
  IToolCallPart,
  IToolDef,
  EPartKind,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../contracts";

import {EResumeAction} from "../../human-gate";

import {runAgentLoop} from "../runAgentLoop";
import {
  ILLMClientHooks,
  IMessage,
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

const refundCall: IToolCallPart = {
  kind: EPartKind.TOOL_CALL,
  callId: "call-refund",
  toolName: "refund",
  input: {amount: 500},
};

/** A paused run: get_invoice ran (result stored), a rejected check_fraud, a failed send_email, then the refund waits for approval. */
const pausedMessages: IMessage[] = [
  {
    role: EMessageRole.USER,
    parts: [{
      kind: EPartKind.TEXT,
      text: "refund",
    }],
  },
  {
    role: EMessageRole.TOOL,
    parts: [{
      kind: EPartKind.TOOL_RESULT,
      callId: "call-invoice",
      toolName: "get_invoice",
      output: {total: 30},
    }],
  },
  {
    role: EMessageRole.TOOL,
    parts: [{
      kind: EPartKind.TOOL_RESULT,
      callId: "call-fraud",
      toolName: "check_fraud",
      output: "skipped",
      rejected: true,
    }],
  },
  {
    role: EMessageRole.TOOL,
    parts: [{
      kind: EPartKind.TOOL_RESULT,
      callId: "call-email",
      toolName: "send_email",
      output: {error: "SMTP down"},
      failed: true,
    }],
  },
  {
    role: EMessageRole.ASSISTANT,
    parts: [refundCall],
  },
];

/** On a resume the loop's `executed` holds what the stored run already ran; rejected and failed calls are left out (D76). */
test("a resume rebuilds executed from the stored tool results, without the rejected and the failed ones", async () => {
  const seen: string[][] = [];
  const hooks: ILLMClientHooks = {
    executeTool: async (): Promise<unknown> => ({ok: true}),
    decideToolCall: (): TToolCallPolicyResult => ({verdict: EToolCallVerdict.ALLOW}),
    prepareStep: ({executed}): IToolDef[] => {
      seen.push([...executed]);
      return [];
    },
    endsRun: (): boolean => false,
    onEvent: (): void => undefined,
  };
  const done: IModelResult = {
    modelId: "model-a",
    text: "done",
    toolCalls: [],
    finishReason: EFinishReason.STOP,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
    },
    latencyMs: 0,
    traceId: "trace-1",
  };

  await runAgentLoop({
    request,
    hooks,
    limits: {maxSteps: 3},
    resume: {
      messages: pausedMessages,
      decisions: [{action: EResumeAction.APPROVE}],
    },
    callModel: async (): Promise<IModelResult> => done,
  });

  expect(seen).toEqual([
    ["get_invoice"],
    ["get_invoice", "refund"],
  ]);
});
