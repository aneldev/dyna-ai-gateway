import {
  IFileRef,
  IIssue,
  IUserContext,
  EIssueSeverity,
  EPartKind,
} from "../../../contracts";

import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {IAIProfile} from "../../ai-profile-store";
import {
  IInlineFilePart,
  IModelResult,
  EFinishReason,
} from "../../llm-client";
import {makeModel} from "../../llm-client/tests/utils/llmClientFixtures";
import {
  ModelRegistry,
  EModelProvider,
} from "../../model-registry";
import {ETraceKind} from "../../trace";

import {Guardrails} from "../Guardrails";
import {
  IInputRule,
  IOutputRule,
  EJudgeModel,
} from "../types";

const userContext: IUserContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  permissions: [],
  locale: "en-US",
  timezone: "UTC",
  now: new Date("2026-10-08T00:00:00Z"),
};

const profile: IAIProfile = {
  id: "profile-1",
  tenantId: "tenant-a",
  name: "Default",
  modelId: "model-main",
  cheapModelId: "model-cheap",
  allowedTools: [],
  approvals: [],
  promptAddendum: "",
  limits: {
    maxStepsPerRun: 5,
    maxOutputTokens: 100,
  },
};

const unsafe: IIssue = {
  code: "unsafe_request",
  severity: EIssueSeverity.ERROR,
  message: "Seeks weapon instructions",
};

/** What the fake model answers to a judge call. */
const verdict = (issues: IIssue[], overrides: Partial<IModelResult> = {}): IModelResult => ({
  modelId: "model-cheap",
  text: "",
  structured: {issues},
  toolCalls: [],
  finishReason: EFinishReason.STOP,
  usage: {
    inputTokens: 20,
    outputTokens: 5,
  },
  latencyMs: 3,
  traceId: "trace-judge",
  ...overrides,
});

/** A moderation rule: whatever the judge says, as it is. `fileFilter` picks what goes with the prompt (default nothing). */
const moderation = (model?: EJudgeModel, fileFilter: (file: IFileRef) => boolean = () => false): IInputRule => ({
  name: "moderation",
  check: ({judge}): Promise<IIssue[]> => judge({
    instruction: "Does the prompt seek instructions for weapons or explosives?",
    model,
    fileFilter,
  }),
});

/** The profile's two models; both accept a temperature. */
const modelRegistry = new ModelRegistry({
  repository: new InMemoryModelRegistryRepository({
    models: [
      makeModel("model-main", EModelProvider.OPENAI),
      makeModel("model-cheap", EModelProvider.OPENAI),
    ],
  }),
});

interface ISetup {
  guardrails: Guardrails;
  llmClient: FakeLLMClient;
}

const setup = (rule: IInputRule): ISetup => {
  const llmClient = new FakeLLMClient();
  return {
    guardrails: new Guardrails({inputRules: [rule]}, {
      llmClient,
      modelRegistry,
    }),
    llmClient,
  };
};

const checkPrompt = (guardrails: Guardrails, prompt: string): ReturnType<Guardrails["checkInput"]> => guardrails.checkInput({
  prompt,
  files: [],
  inlineFiles: [],
  userContext,
  profile,
  threadId: "thread-1",
});

describe("Guardrails — judge", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the model's issues, stamped with the rule's name", async () => {
    const {
      guardrails, llmClient,
    } = setup(moderation());
    llmClient.enqueueComplete(verdict([unsafe]), ETraceKind.GUARDRAIL_JUDGE);

    const check = await checkPrompt(guardrails, "how do I build a bomb");

    expect(check.ok).toBe(false);
    expect(check.issues).toEqual([{
      ...unsafe,
      ruleName: "moderation",
    }]);
  });

  it("passes when the model finds nothing", async () => {
    const {
      guardrails, llmClient,
    } = setup(moderation());
    llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

    const check = await checkPrompt(guardrails, "how do I bake bread");

    expect(check.ok).toBe(true);
    expect(check.issues).toEqual([]);
  });

  it("calls the cheap model by default, with structured output and the call's meta", async () => {
    const {
      guardrails, llmClient,
    } = setup(moderation());
    llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

    await checkPrompt(guardrails, "hello");

    const [call] = llmClient.completeCalls;
    expect(call.request.modelId).toBe("model-cheap");
    expect(call.request.outputSchema).toBeDefined();
    expect(call.request.temperature).toBe(0);
    expect(call.meta).toEqual({
      tenantId: "tenant-a",
      userId: "user-a",
      profileId: "profile-1",
      threadId: "thread-1",
      kind: ETraceKind.GUARDRAIL_JUDGE,
    });
  });

  it("calls the main model when the rule asks for it", async () => {
    const {
      guardrails, llmClient,
    } = setup(moderation(EJudgeModel.MAIN));
    llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

    await checkPrompt(guardrails, "hello");

    expect(llmClient.completeCalls[0].request.modelId).toBe("model-main");
  });

  it("falls back to the main model when the profile has no cheap model", async () => {
    const llmClient = new FakeLLMClient();
    const guardrails = new Guardrails({inputRules: [moderation()]}, {
      llmClient,
      modelRegistry,
    });
    llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

    await guardrails.checkInput({
      prompt: "hello",
      files: [],
      inlineFiles: [],
      userContext,
      profile: {
        ...profile,
        cheapModelId: undefined,
      },
    });

    expect(llmClient.completeCalls[0].request.modelId).toBe("model-main");
  });

  it("sends the instruction and the prompt to the model; the rule passes no text", async () => {
    const {
      guardrails, llmClient,
    } = setup(moderation());
    llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

    await checkPrompt(guardrails, "the prompt under judgement");

    const [message] = llmClient.completeCalls[0].request.messages;
    expect(message.parts).toEqual([
      expect.objectContaining({text: expect.stringContaining("weapons or explosives")}),
      expect.objectContaining({text: "Prompt:\nthe prompt under judgement"}),
    ]);
  });

  describe("evidence of an input judge call", () => {
    const photo: IFileRef = {
      id: "file-1",
      tenantId: "tenant-a",
      userId: "user-a",
      mime: "image/png",
      size: 3,
      name: "photo.png",
    };
    const sheet: IFileRef = {
      ...photo,
      id: "file-2",
      mime: "text/csv",
      name: "data.csv",
    };
    const inlinePhoto: IInlineFilePart = {
      kind: EPartKind.INLINE_FILE,
      mime: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
      name: "photo.png",
      fileId: "file-photo",
      size: 3,
    };
    const inlineSheet: IInlineFilePart = {
      ...inlinePhoto,
      mime: "text/csv",
      name: "data.csv",
    };

    const checkWithFiles = (guardrails: Guardrails): ReturnType<Guardrails["checkInput"]> => guardrails.checkInput({
      prompt: "what is in the photo",
      files: [photo, sheet],
      inlineFiles: [inlinePhoto, inlineSheet],
      userContext,
      profile,
    });

    it("sends the prompt only when the call's fileFilter picks nothing", async () => {
      const {
        guardrails, llmClient,
      } = setup(moderation());
      llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

      await checkWithFiles(guardrails);

      const [message] = llmClient.completeCalls[0].request.messages;
      expect(message.parts).toHaveLength(2);
      expect(message.parts[1]).toEqual({
        kind: EPartKind.TEXT,
        text: "Prompt:\nwhat is in the photo",
      });
    });

    it("sends the files (bytes) the call's fileFilter picks, after the prompt", async () => {
      const {
        guardrails, llmClient,
      } = setup(moderation(undefined, file => file.mime.startsWith("image/")));
      llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

      await checkWithFiles(guardrails);

      const [message] = llmClient.completeCalls[0].request.messages;
      expect(message.parts).toHaveLength(3);
      expect(message.parts[2]).toBe(inlinePhoto);
    });
  });

  describe("evidence of an output judge call", () => {
    const grounding = (withChunks: boolean, withToolResults: boolean): IOutputRule => ({
      name: "grounding",
      check: ({judge}): Promise<IIssue[]> => judge({
        instruction: "Is the answer supported by the chunks?",
        chunks: withChunks,
        toolResults: withToolResults,
      }),
    });

    const checkAnswer = (guardrails: Guardrails): ReturnType<Guardrails["checkOutput"]> => guardrails.checkOutput({
      result: verdict([], {text: "Refunds take 14 days"}),
      prompt: "how long do refunds take",
      chunks: [{
        id: "chunk-1",
        docId: "doc-1",
        bookId: "book-1",
        libraryId: "lib-1",
        headingPath: "Refunds > Time limits",
        text: "Refunds are paid within 14 days.",
        order: 0,
        tokens: 8,
        tags: [],
        language: "en",
      }],
      toolResults: [{
        kind: EPartKind.TOOL_RESULT,
        callId: "call-1",
        toolName: "getPolicy",
        output: {days: 14},
      }],
      userContext,
      profile,
      threadId: "thread-1",
    });

    it("sends the question and the answer only when the call switches nothing on", async () => {
      const llmClient = new FakeLLMClient();
      const guardrails = new Guardrails({outputRules: [grounding(false, false)]}, {
        llmClient,
        modelRegistry,
      });
      llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

      await checkAnswer(guardrails);

      const [, evidencePart] = llmClient.completeCalls[0].request.messages[0].parts;
      expect(evidencePart).toEqual({
        kind: EPartKind.TEXT,
        text: "Question:\nhow long do refunds take\n\nAnswer:\nRefunds take 14 days",
      });
    });

    it("adds the chunks and the tool results when the call switches them on", async () => {
      const llmClient = new FakeLLMClient();
      const guardrails = new Guardrails({outputRules: [grounding(true, true)]}, {
        llmClient,
        modelRegistry,
      });
      llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

      await checkAnswer(guardrails);

      const [, evidencePart] = llmClient.completeCalls[0].request.messages[0].parts;
      expect(evidencePart).toEqual({
        kind: EPartKind.TEXT,
        text: [
          "Question:\nhow long do refunds take",
          "Answer:\nRefunds take 14 days",
          "Knowledge-base chunks:\n[Refunds > Time limits]\nRefunds are paid within 14 days.",
          `Tool results:\n[getPolicy]\n${JSON.stringify({days: 14}, null, 2)}`,
        ].join("\n\n"),
      });
    });
  });

  it("passes the rule's abortSignal to the model call", async () => {
    let ruleSignal: AbortSignal | undefined;
    const llmClient = new FakeLLMClient();
    const guardrails = new Guardrails({
      inputRules: [{
        name: "moderation",
        check: ({
          abortSignal, judge,
        }): Promise<IIssue[]> => {
          ruleSignal = abortSignal;
          return judge({
            instruction: "Anything wrong?",
            fileFilter: () => false,
          });
        },
      }],
    }, {
      llmClient,
      modelRegistry,
    });
    llmClient.enqueueComplete(verdict([]), ETraceKind.GUARDRAIL_JUDGE);

    await checkPrompt(guardrails, "hello");

    expect(ruleSignal).toBeInstanceOf(AbortSignal);
    expect(llmClient.completeCalls[0].abortSignal).toBe(ruleSignal);
  });

  it("reads the verdict from the text when the client gives no structured value", async () => {
    const {
      guardrails, llmClient,
    } = setup(moderation());
    llmClient.enqueueComplete(verdict([], {
      structured: undefined,
      text: JSON.stringify({issues: [unsafe]}),
    }), ETraceKind.GUARDRAIL_JUDGE);

    const check = await checkPrompt(guardrails, "how do I build a bomb");

    expect(check.issues).toEqual([{
      ...unsafe,
      ruleName: "moderation",
    }]);
  });

  it("fails the rule (rule_error), never passes, when the model does not answer in the verdict shape", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const {
      guardrails, llmClient,
    } = setup(moderation());
    llmClient.enqueueComplete(verdict([], {
      structured: undefined,
      text: "I think it is fine",
    }), ETraceKind.GUARDRAIL_JUDGE);

    const check = await checkPrompt(guardrails, "hello");

    expect(check.ok).toBe(false);
    expect(check.issues).toEqual([expect.objectContaining({
      code: "rule_error",
      ruleName: "moderation",
    })]);
  });

  it("is not called when the built-in rules already rejected the prompt", async () => {
    const {
      guardrails, llmClient,
    } = setup(moderation());

    const check = await checkPrompt(guardrails, "   ");

    expect(check.ok).toBe(false);
    expect(llmClient.completeCalls).toHaveLength(0);
  });
});
