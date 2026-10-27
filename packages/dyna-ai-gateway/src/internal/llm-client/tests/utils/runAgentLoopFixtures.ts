import {
  z,
} from "zod";

import {
  IToolCallPart,
  IToolDef,
  EPartKind,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../../contracts";

import {
  IResumeDecision,
} from "../../../human-gate";

import {
  runAgentLoop,
} from "../../runAgentLoop";
import {
  ILLMClientEvent,
  ILLMClientHooks,
  IMessage,
  IModelRequest,
  IModelResult,
  IRunOutcome,
  EFinishReason,
  ELLMClientEventKind,
} from "../../types";

export const request: IModelRequest = {
  modelId: "model-a",
  system: "You are a test",
  messages: [],
  maxOutputTokens: 500,
};

export const makeCall = (toolName: string, callId = `call-${toolName}`): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId,
  toolName,
  input: {reason: "asked"},
});

export const makeResult = (index: number, toolCalls: IToolCallPart[], text = ""): IModelResult => ({
  modelId: "model-a",
  text,
  toolCalls,
  finishReason: toolCalls.length > 0 ? EFinishReason.TOOL_CALLS : EFinishReason.STOP,
  usage: {
    inputTokens: 10,
    outputTokens: 1,
  },
  latencyMs: 0,
  traceId: `trace-${index}`,
});

export interface ILoopProbe {
  hooks: ILLMClientHooks;
  /** What every model call received. */
  modelCalls: Array<{messages: IMessage[]; tools: IToolDef[]; stepIndex: number}>;
  /** Tool names `executeTool` ran, in order. */
  executed: string[];
  /** What `prepareStep` received as `executed`, one entry per step. */
  stepExecuted: string[][];
  events: ILLMClientEvent[];
  /** The event kinds, in order. */
  eventKinds(): ELLMClientEventKind[];
  run(options?: {maxSteps?: number; resume?: {messages: IMessage[]; decisions: IResumeDecision[]; rejectionTexts?: Record<string, string>}}): Promise<IRunOutcome>;
}

/**
 * A loop over scripted model answers (the last one repeats). Every step offers `offered`; a call to a tool outside it is refused
 * by `executeTool` (D72). `terminal` tools end the run when their output is `{status: "accepted"}`, the default output;
 * `outputs` overrides a tool's output. `approvals` pause (`approvalTexts` gives the policy's rejection text per tool, D87), `denied` tools
 * are refused with the given reason (D87), `failing` tools throw.
 */
export const makeLoopProbe = (
  {
    script,
    offered = ["handover", "log_event", "get_invoice"],
    terminal = ["handover"],
    outputs = {},
    approvals = [],
    approvalTexts = {},
    denied = {},
    failing = [],
  }: {
    script: Array<{toolCalls?: IToolCallPart[]; text?: string}>;
    offered?: string[];
    terminal?: string[];
    outputs?: Record<string, unknown>;
    approvals?: string[];
    approvalTexts?: Record<string, string>;
    denied?: Record<string, string>;
    failing?: string[];
  },
): ILoopProbe => {
  const modelCalls: ILoopProbe["modelCalls"] = [];
  const executed: string[] = [];
  const stepExecuted: string[][] = [];
  const events: ILLMClientEvent[] = [];
  const hooks: ILLMClientHooks = {
    executeTool: async ({
      call,
      tools,
    }): Promise<unknown> => {
      if (!tools.some(tool => tool.name === call.toolName)) throw new Error(`${call.toolName} is not a tool of this step`);
      if (failing.includes(call.toolName)) throw new Error(`${call.toolName} failed`);
      executed.push(call.toolName);
      return outputs[call.toolName] ?? {status: "accepted"};
    },
    decideToolCall: ({call}): TToolCallPolicyResult => {
      const reason = denied[call.toolName];
      if (reason !== undefined) {
        return {
          verdict: EToolCallVerdict.DENY,
          reason,
        };
      }
      if (!approvals.includes(call.toolName)) return {verdict: EToolCallVerdict.ALLOW};
      const rejectionText = approvalTexts[call.toolName];
      return {
        verdict: EToolCallVerdict.NEEDS_APPROVAL,
        ...rejectionText === undefined ? {} : {rejectionText},
      };
    },
    endsRun: ({
      call,
      output,
    }): boolean => terminal.includes(call.toolName) && (output as {status?: string}).status === "accepted",
    prepareStep: ({executed: ran}): IToolDef[] => {
      stepExecuted.push([...ran]);
      return offered.map(name => ({
        name,
        description: "",
        inputSchema: z.object({}),
        tags: [],
        execute: async (): Promise<unknown> => undefined,
      }));
    },
    onEvent: ({event}): void => void events.push(event),
  };
  return {
    hooks,
    modelCalls,
    executed,
    stepExecuted,
    events,
    eventKinds: () => events.map(event => event.kind),
    run: ({
      maxSteps = 10,
      resume,
    } = {}) => runAgentLoop({
      request,
      hooks,
      limits: {maxSteps},
      resume,
      callModel: async call => {
        modelCalls.push(call);
        const step = script[Math.min(modelCalls.length - 1, script.length - 1)];
        return makeResult(modelCalls.length, step.toolCalls ?? [], step.text);
      },
    }),
  };
};
