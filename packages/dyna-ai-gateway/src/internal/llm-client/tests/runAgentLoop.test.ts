import {z} from "zod";

import {
  IToolCallPart,
  IToolDef,
  EPartKind,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../contracts";

import {EResumeAction} from "../../human-gate";
import {TOOL_FAILURE_TEXT} from "../../tool-registry/formatToolError";

import {runAgentLoop} from "../runAgentLoop";
import {
  ILLMClientHooks,
  IMessage,
  IModelRequest,
  IModelResult,
  IRunOutcome,
  EFinishReason,
  EMessageRole,
  ERunOutcomeStatus,
} from "../types";

// The loop's basic paths (execute, pause, the resume actions, events) are covered through FakeLLMClient,
// Which runs this same loop: tests/internal/fakes/tests/FakeLLMClient.run.test.ts and FakeLLMClient.resume.test.ts.

const request: IModelRequest = {
  modelId: "model-a",
  system: [{text: "You are a test"}],
  messages: [],
  maxOutputTokens: 500,
};

const makeCall = (toolName: string): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId: `call-${toolName}`,
  toolName,
  input: {id: "4521"},
});

const makeResult = (index: number, toolCalls: IToolCallPart[], text = ""): IModelResult => ({
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

interface IProbe {
  hooks: ILLMClientHooks;
  /** What every model call received. */
  modelCalls: Array<{messages: IMessage[]; tools: IToolDef[]; stepIndex: number}>;
  executed: string[];
  run(options?: {maxSteps?: number; resumeMessages?: IMessage[]; parallelToolCalls?: boolean}): Promise<IRunOutcome>;
}

/** A loop over scripted model answers (the last one repeats); `approvals` pause, `failing` tools throw, `slow` tools finish after the others, `ending` tools end the run (D86). */
const makeProbe = (
  {
    script,
    approvals = [],
    failing = [],
    slow = [],
    ending = [],
  }: {
    script: Array<{toolCalls?: IToolCallPart[]; text?: string}>;
    approvals?: string[];
    failing?: string[];
    slow?: string[];
    ending?: string[];
  },
): IProbe => {
  const modelCalls: IProbe["modelCalls"] = [];
  const executed: string[] = [];
  const hooks: ILLMClientHooks = {
    executeTool: async ({call}): Promise<unknown> => {
      if (failing.includes(call.toolName)) throw new Error(`${call.toolName} failed`);
      if (slow.includes(call.toolName)) await new Promise(resolve => setTimeout(resolve, 20));
      executed.push(call.toolName);
      return {done: call.toolName};
    },
    decideToolCall: ({call}): TToolCallPolicyResult => ({verdict: approvals.includes(call.toolName) ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW}),
    // The step's tool, plus the tools that may pause: only an offered tool is asked for approval (D79)
    prepareStep: ({stepIndex}): IToolDef[] => [`tool-of-step-${stepIndex}`, ...approvals].map(name => ({
      name,
      description: "",
      inputSchema: z.object({}),
      tags: [],
      execute: async (): Promise<unknown> => undefined,
    })),
    endsRun: ({call}): boolean => ending.includes(call.toolName),
    onEvent: (): void => undefined,
  };
  return {
    hooks,
    modelCalls,
    executed,
    run: ({
      maxSteps = 10,
      resumeMessages,
      parallelToolCalls,
    } = {}) => runAgentLoop({
      request,
      hooks,
      limits: {maxSteps},
      ...parallelToolCalls === undefined ? {} : {parallelToolCalls},
      resume: resumeMessages && {
        messages: resumeMessages,
        decisions: [{action: EResumeAction.APPROVE}],
      },
      callModel: async call => {
        modelCalls.push(call);
        const step = script[Math.min(modelCalls.length - 1, script.length - 1)];
        return makeResult(modelCalls.length, step.toolCalls ?? [], step.text);
      },
    }),
  };
};

const toolResultOf = (outcome: IRunOutcome, callId: string): unknown =>
  outcome.messages
    .flatMap(message => message.parts)
    .find(part => part.kind === EPartKind.TOOL_RESULT && part.callId === callId);

describe("runAgentLoop", () => {
  describe("M2 — limits", () => {
    test("stops at limits.maxSteps with finishReason LENGTH", async () => {
      const probe = makeProbe({script: [{toolCalls: [makeCall("get_invoice")]}]});
      const outcome = await probe.run({maxSteps: 3});
      expect([outcome.status, outcome.result?.finishReason, probe.modelCalls.length]).toEqual([ERunOutcomeStatus.DONE, EFinishReason.LENGTH, 3]);
    });

    test("with maxSteps 0 the model is not called at all", async () => {
      const probe = makeProbe({script: [{text: "never"}]});
      const outcome = await probe.run({maxSteps: 0});
      expect([probe.modelCalls.length, outcome.result?.text, outcome.result?.finishReason]).toEqual([0, "", EFinishReason.LENGTH]);
    });
  });

  describe("M2 — what the model receives", () => {
    test("each step gets the tools that hooks.prepareStep returns for it", async () => {
      const probe = makeProbe({script: [{toolCalls: [makeCall("get_invoice")]}, {text: "done"}]});
      await probe.run();
      expect(probe.modelCalls.map(call => call.tools.map(tool => tool.name))).toEqual([["tool-of-step-0"], ["tool-of-step-1"]]);
    });

    test("the next step gets the tool request and its result as messages", async () => {
      const probe = makeProbe({script: [{toolCalls: [makeCall("get_invoice")]}, {text: "done"}]});
      await probe.run();
      expect(probe.modelCalls[1].messages.map(message => message.role)).toEqual([EMessageRole.ASSISTANT, EMessageRole.TOOL]);
    });
  });

  describe("M2 — tools", () => {
    test("an error thrown by a tool goes back to the model as that tool's result, its message kept from the model", async () => {
      const probe = makeProbe({
        script: [{toolCalls: [makeCall("get_invoice")]}, {text: "sorry"}],
        failing: ["get_invoice"],
      });
      const outcome = await probe.run();
      expect(toolResultOf(outcome, "call-get_invoice")).toMatchObject({
        output: {error: `userMessage: ${TOOL_FAILURE_TEXT}`},
        failed: true,
      });
    });

    test("a tool error does not end the run", async () => {
      const probe = makeProbe({
        script: [{toolCalls: [makeCall("get_invoice")]}, {text: "sorry"}],
        failing: ["get_invoice"],
      });
      expect((await probe.run()).result?.text).toBe("sorry");
    });

    test("of several calls in one step, every allowed call runs before the pause; the one that needs approval is pending (D101)", async () => {
      const probe = makeProbe({
        script: [{toolCalls: [makeCall("get_invoice"), makeCall("refund"), makeCall("send_email")]}],
        approvals: ["refund"],
      });
      const outcome = await probe.run();
      expect([outcome.status, outcome.pendingCalls?.map(pending => pending.call.toolName), probe.executed]).toEqual([ERunOutcomeStatus.PAUSED, ["refund"], ["get_invoice", "send_email"]]);
    });

    test("sequential: of several calls in one step, only the ones before the call that needs approval are executed", async () => {
      const probe = makeProbe({
        script: [{toolCalls: [makeCall("get_invoice"), makeCall("refund"), makeCall("send_email")]}],
        approvals: ["refund"],
      });
      const outcome = await probe.run({parallelToolCalls: false});
      expect([outcome.status, outcome.pendingCalls?.map(pending => pending.call.toolName), probe.executed]).toEqual([ERunOutcomeStatus.PAUSED, ["refund"], ["get_invoice"]]);
    });

    test("after a resume, only the approved call is left to run: its siblings ran before the pause", async () => {
      const first = makeProbe({
        script: [{toolCalls: [makeCall("get_invoice"), makeCall("refund"), makeCall("send_email")]}],
        approvals: ["refund"],
      });
      const paused = await first.run();
      const second = makeProbe({script: [{text: "all done"}]});
      const outcome = await second.run({resumeMessages: paused.messages});
      expect([second.executed, outcome.result?.text]).toEqual([["refund"], "all done"]);
    });

    test("sequential: after a resume, the calls behind the approved one are handled too, before the model is called again", async () => {
      const first = makeProbe({
        script: [{toolCalls: [makeCall("get_invoice"), makeCall("refund"), makeCall("send_email")]}],
        approvals: ["refund"],
      });
      const paused = await first.run({parallelToolCalls: false});
      const second = makeProbe({script: [{text: "all done"}]});
      const outcome = await second.run({
        resumeMessages: paused.messages,
        parallelToolCalls: false,
      });
      expect([second.executed, outcome.result?.text]).toEqual([["refund", "send_email"], "all done"]);
    });

    test("the results of a parallel step are stored in request order, whatever order the tools finished in", async () => {
      const probe = makeProbe({
        script: [{toolCalls: [makeCall("slow_lookup"), makeCall("get_invoice")]}, {text: "done"}],
        slow: ["slow_lookup"],
      });
      const outcome = await probe.run();
      const resultIds = outcome.messages.flatMap(message => message.parts.flatMap(part => part.kind === EPartKind.TOOL_RESULT ? [part.callId] : []));
      expect([probe.executed, resultIds]).toEqual([["get_invoice", "slow_lookup"], ["call-slow_lookup", "call-get_invoice"]]);
    });

    test("of two calls of a parallel step that end the run, the first in request order is the one that ended it (D86)", async () => {
      const probe = makeProbe({
        script: [{toolCalls: [makeCall("slow_handover"), makeCall("escalate")]}, {text: "handed over"}],
        slow: ["slow_handover"],
        ending: ["slow_handover", "escalate"],
      });
      const outcome = await probe.run();
      expect([probe.executed, outcome.endedByTool]).toEqual([["escalate", "slow_handover"], "slow_handover"]);
    });

    test("a resume pauses again when a later call of the same step needs approval", async () => {
      const first = makeProbe({
        script: [{toolCalls: [makeCall("refund"), makeCall("send_email")]}],
        approvals: ["refund", "send_email"],
      });
      const paused = await first.run();
      const second = makeProbe({
        script: [{text: "never reached"}],
        approvals: ["send_email"],
      });
      const outcome = await second.run({resumeMessages: paused.messages});
      expect([outcome.status, outcome.pendingCalls?.[0]?.call.toolName, second.modelCalls.length]).toEqual([ERunOutcomeStatus.PAUSED, "send_email", 0]);
    });
  });

  describe("M2 — accounting", () => {
    test("traceIds holds one id per model call, in order", async () => {
      const probe = makeProbe({script: [{toolCalls: [makeCall("get_invoice")]}, {text: "done"}]});
      expect((await probe.run()).traceIds).toEqual(["trace-1", "trace-2"]);
    });

    test("the result of a finished run is the last model call's result", async () => {
      const probe = makeProbe({script: [{toolCalls: [makeCall("get_invoice")]}, {text: "done"}]});
      expect((await probe.run()).result).toMatchObject({
        text: "done",
        traceId: "trace-2",
        finishReason: EFinishReason.STOP,
      });
    });
  });
});
