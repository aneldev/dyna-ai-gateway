import {z} from "zod";

import {
  ILLMClient,
  ILLMClientEvent,
  ILLMClientHooks,
  IModelRequest,
  IResumeDecision,
  IRunOutcome,
  IToolCallPart,
  IToolDef,
  EPartKind,
  ETraceKind,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../../..";

import {FakeLLMClient} from "../../FakeLLMClient";

export const request: IModelRequest = {
  modelId: "model-a",
  system: [{text: "You are a test"}],
  messages: [],
  maxOutputTokens: 500,
};

export const makeCall = (toolName: string, input: unknown = {invoiceId: "4521"}): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId: `call-${toolName}`,
  toolName,
  input,
});

export interface IRunProbe {
  hooks: ILLMClientHooks;
  /** Every call `executeTool` received. */
  executed: IToolCallPart[];
  events: ILLMClientEvent[];
}

/** Hooks that record what the llmClient asks for; tools listed in `approvals` pause the run. */
export const makeProbe = (approvals: string[] = []): IRunProbe => {
  const executed: IToolCallPart[] = [];
  const events: ILLMClientEvent[] = [];
  return {
    executed,
    events,
    hooks: {
      executeTool: async ({call}): Promise<unknown> => {
        executed.push(call);
        return {done: call.toolName};
      },
      decideToolCall: ({call}): TToolCallPolicyResult => ({verdict: approvals.includes(call.toolName) ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW}),
      // Only an offered tool is asked for approval (D79): the step offers the tools that may pause
      prepareStep: (): IToolDef[] => approvals.map(name => ({
        name,
        description: "",
        inputSchema: z.object({}),
        tags: [],
        execute: async (): Promise<unknown> => undefined,
      })),
      endsRun: (): boolean => false,
      onEvent: ({event}): void => void events.push(event),
    },
  };
};

export const run = (llmClient: FakeLLMClient, probe: IRunProbe, resume?: Parameters<ILLMClient["run"]>[0]["resume"]): Promise<IRunOutcome> =>
  llmClient.run({
    request,
    meta: {
      tenantId: "tenant-a",
      kind: ETraceKind.RUN_STEP,
    },
    tools: [],
    hooks: probe.hooks,
    limits: {maxSteps: 10},
    resume,
  });

/** Runs until the pause on `refund`, then resumes with the decision. */
export const pauseAndResume = async (llmClient: FakeLLMClient, probe: IRunProbe, decision: IResumeDecision): Promise<IRunOutcome> => {
  const paused = await run(llmClient, probe);
  return run(llmClient, probe, {
    messages: paused.messages,
    decisions: [decision],
  });
};
