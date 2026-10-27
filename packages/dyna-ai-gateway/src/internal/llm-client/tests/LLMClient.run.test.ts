import {z} from "zod";
import {
  MockLanguageModelV4,
  simulateReadableStream,
} from "ai/test";

import {
  IToolCallPart,
  IToolDef,
  DEFAULT_TOOL_REJECTION_TEXT,
  EPartKind,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../../../contracts";

import {EModelProvider} from "../../model-registry";
import {EResumeAction} from "../../human-gate";
import {defineTool} from "../../tool-registry";

import {
  ILLMClientHooks,
  IRunOutcome,
  EMessageRole,
  ERunOutcomeStatus,
} from "../types";
import {createLanguageModel} from "../utils/createLanguageModel";
import {
  findToolOutput,
  makeLLMClient,
  makeModel,
  makeRequest,
  meta,
} from "./utils/llmClientFixtures";

jest.mock("../utils/createLanguageModel");

type TStream = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doStream"];
type TStreamResult = Awaited<ReturnType<Extract<TStream, (...args: never[]) => unknown>>>;
type TChunk = TStreamResult["stream"] extends ReadableStream<infer TPart> ? TPart : never;

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 2,
    text: 2,
    reasoning: undefined,
  },
};

const finish = (unified: "stop" | "tool-calls"): TChunk => ({
  type: "finish",
  finishReason: {
    unified,
    raw: undefined,
  },
  usage,
});

const toolCallStep = (toolName: string): TChunk[] => [
  {
    type: "stream-start",
    warnings: [],
  },
  {
    type: "tool-call",
    toolCallId: `call-${toolName}`,
    toolName,
    input: JSON.stringify({invoiceId: "4521"}),
  },
  finish("tool-calls"),
];

const textStep = (text: string): TChunk[] => [
  {
    type: "stream-start",
    warnings: [],
  },
  {
    type: "text-start",
    id: "text-1",
  },
  {
    type: "text-delta",
    id: "text-1",
    delta: text,
  },
  {
    type: "text-end",
    id: "text-1",
  },
  finish("stop"),
];

/** Makes the mocked createLanguageModel return a model that streams the given steps, one per call. */
const mockModel = (steps: TChunk[][]): MockLanguageModelV4 => {
  let call = 0;
  const model = new MockLanguageModelV4({doStream: async () => ({stream: simulateReadableStream({chunks: steps[call++]})})});
  jest.mocked(createLanguageModel).mockReturnValue(model);
  return model;
};

const tools: IToolDef[] = ["get_invoice", "refund"].map(name => defineTool({
  name,
  description: `Tool ${name}`,
  inputSchema: z.object({invoiceId: z.string()}),
  tags: [],
  policy: name === "refund" ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW,
  execute: async (): Promise<string> => name,
}));

interface IProbe {
  hooks: ILLMClientHooks;
  executed: IToolCallPart[];
}

const makeProbe = (): IProbe => {
  const executed: IToolCallPart[] = [];
  return {
    executed,
    hooks: {
      executeTool: async ({call}): Promise<unknown> => {
        executed.push(call);
        return {total: 30};
      },
      decideToolCall: ({call}): TToolCallPolicyResult => ({verdict: call.toolName === "refund" ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW}),
      prepareStep: (): IToolDef[] => tools,
      endsRun: (): boolean => false,
      onEvent: (): void => undefined,
    },
  };
};

const run = async (probe: IProbe, resume?: {messages: IRunOutcome["messages"]; action: EResumeAction; text?: string}): Promise<IRunOutcome> => {
  const client = await makeLLMClient([makeModel("model-a", EModelProvider.OPENAI)], {providers: {[EModelProvider.OPENAI]: {apiKey: "test-key"}}});
  return client.run({
    request: makeRequest(),
    meta,
    tools,
    hooks: probe.hooks,
    limits: {maxSteps: 5},
    resume: resume && {
      messages: resume.messages,
      decisions: [{
        action: resume.action,
        text: resume.text,
      }],
    },
  });
};

describe("LLMClient — M2: run on the SDK", () => {
  test("a tool the model asks for is executed through the hook, and its result reaches the next model call", async () => {
    const model = mockModel([toolCallStep("get_invoice"), textStep("The total is 30.")]);
    const probe = makeProbe();
    const outcome = await run(probe);
    const secondPrompt = model.doStreamCalls[1].prompt;
    expect([
      outcome.status,
      outcome.result?.text,
      probe.executed.map(call => call.input),
      secondPrompt.map(message => message.role),
    ]).toEqual([
      ERunOutcomeStatus.DONE,
      "The total is 30.",
      [{invoiceId: "4521"}],
      ["system", "user", "assistant", "tool"],
    ]);
  });

  test("the SDK is offered the step's tools by name", async () => {
    const model = mockModel([textStep("hello")]);
    await run(makeProbe());
    expect((model.doStreamCalls[0].tools ?? []).map(tool => tool.name)).toEqual(["get_invoice", "refund"]);
  });

  test("a tool that needs approval pauses the run: it is not executed and the call is pending", async () => {
    mockModel([toolCallStep("refund")]);
    const probe = makeProbe();
    const outcome = await run(probe);
    expect([outcome.status, outcome.pendingCalls?.[0]?.call, probe.executed]).toEqual([
      ERunOutcomeStatus.PAUSED,
      {
        kind: EPartKind.TOOL_CALL,
        callId: "call-refund",
        toolName: "refund",
        input: {invoiceId: "4521"},
      },
      [],
    ]);
  });

  test("resume APPROVE executes the pending tool and the run finishes", async () => {
    mockModel([toolCallStep("refund")]);
    const paused = await run(makeProbe());
    mockModel([textStep("Refunded.")]);
    const probe = makeProbe();
    const outcome = await run(probe, {
      messages: paused.messages,
      action: EResumeAction.APPROVE,
    });
    expect([outcome.status, outcome.result?.text, probe.executed.map(call => call.toolName)]).toEqual([ERunOutcomeStatus.DONE, "Refunded.", ["refund"]]);
  });

  test("resume REJECT sends the model an execution-denied result with the reason", async () => {
    mockModel([toolCallStep("refund")]);
    const paused = await run(makeProbe());
    const model = mockModel([textStep("Understood.")]);
    await run(makeProbe(), {
      messages: paused.messages,
      action: EResumeAction.REJECT,
      text: "too expensive",
    });
    expect(findToolOutput(model.doStreamCalls[0].prompt)).toEqual({
      type: "execution-denied",
      reason: `${DEFAULT_TOOL_REJECTION_TEXT} Reason: too expensive`,
    });
  });

  test("resume REJECT without a reason still tells the model the tool was not executed", async () => {
    mockModel([toolCallStep("refund")]);
    const paused = await run(makeProbe());
    const model = mockModel([textStep("Understood.")]);
    await run(makeProbe(), {
      messages: paused.messages,
      action: EResumeAction.REJECT,
    });
    expect(findToolOutput(model.doStreamCalls[0].prompt)).toEqual({
      type: "execution-denied",
      reason: DEFAULT_TOOL_REJECTION_TEXT,
    });
  });

  test("the outcome's messages end with the assistant's final text", async () => {
    mockModel([toolCallStep("get_invoice"), textStep("The total is 30.")]);
    const outcome = await run(makeProbe());
    const last = outcome.messages[outcome.messages.length - 1];
    expect([last.role, last.parts]).toEqual([
      EMessageRole.ASSISTANT,
      [{
        kind: EPartKind.TEXT,
        text: "The total is 30.",
      }],
    ]);
  });
});
