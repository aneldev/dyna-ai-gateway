import {InMemoryPromptTemplateRepository} from "../../../adapters/in-memory";
import {EPartKind} from "../../../contracts";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {
  ILLMClientCallMeta,
  EFinishReason,
  EMessageRole,
} from "../../llm-client";
import {PromptTemplateStore} from "../../prompt-template-store";
import {ETraceKind} from "../../trace";

import {QueryRewriter} from "../QueryRewriter";

const meta: ILLMClientCallMeta = {
  tenantId: "tenant-a",
  userId: "user-a",
  threadId: "thread-1",
  kind: ETraceKind.QUERY_REWRITE,
};

interface ISetup {
  rewriter: QueryRewriter;
  llmClient: FakeLLMClient;
}

const setup = (enabled = true): ISetup => {
  const llmClient = new FakeLLMClient();
  return {
    llmClient,
    rewriter: new QueryRewriter({enabled}, {
      llmClient,
      promptTemplateStore: new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
    }),
  };
};

const memory = {
  summary: "The user asks about refunds of paid invoices.",
  facts: {invoiceId: "4521"},
};

/** The model answers with `answer`; then the prompt is rewritten with the given memory. */
const rewrite = (
  {
    rewriter,
    llmClient,
  }: ISetup,
  answer: string | null,
  threadMemory: {summary: string; facts: Record<string, string>} = memory,
): Promise<string> => {
  if (answer !== null) {
    llmClient.enqueueComplete({
      modelId: "cheap-model",
      text: answer,
      toolCalls: [],
      finishReason: EFinishReason.STOP,
      usage: {
        inputTokens: 10,
        outputTokens: 2,
      },
      latencyMs: 1,
      traceId: "trace-1",
    }, ETraceKind.QUERY_REWRITE);
  }
  return rewriter.rewrite({
    prompt: "and for last year's?",
    ...threadMemory,
    cheapModelId: "cheap-model",
    meta,
  });
};

describe("QueryRewriter", () => {
  afterEach(() => jest.restoreAllMocks());

  describe("M5 — rewrite, switched off", () => {
    test("returns the prompt itself, without a model call", async () => {
      const context = setup(false);
      expect([await rewrite(context, null), context.llmClient.completeCalls.length]).toEqual(["and for last year's?", 0]);
    });
  });

  describe("M5 — rewrite, switched on", () => {
    test("returns the query the model made", async () => {
      expect(await rewrite(setup(), "refund time limit paid invoice last year")).toBe("refund time limit paid invoice last year");
    });

    test("calls the cheap model with the caller's meta, the prompt as the only message", async () => {
      const context = setup();
      await rewrite(context, "query");
      const [call] = context.llmClient.completeCalls;
      expect([call.request.modelId, call.meta, call.request.messages]).toEqual([
        "cheap-model",
        meta,
        [
          {
            role: EMessageRole.USER,
            parts: [
              {
                kind: EPartKind.TEXT,
                text: "and for last year's?",
              },
            ],
          },
        ],
      ]);
    });

    test("the system prompt carries the thread's summary and facts", async () => {
      const context = setup();
      await rewrite(context, "query");
      const {system} = context.llmClient.completeCalls[0].request;
      expect([system.includes("The user asks about refunds of paid invoices."), system.includes("invoiceId: 4521")]).toEqual([true, true]);
    });

    test("keeps the first line of the model's answer, without quotes around it", async () => {
      expect(await rewrite(setup(), "  \"refund time limit\"\nBecause the user asked about refunds.")).toBe("refund time limit");
    });

    test("a thread without memory has nothing to resolve: the prompt is returned without a model call", async () => {
      const context = setup();
      const query = await rewrite(context, null, {
        summary: "",
        facts: {},
      });
      expect([query, context.llmClient.completeCalls.length]).toEqual(["and for last year's?", 0]);
    });

    test("an empty answer of the model falls back to the prompt", async () => {
      expect(await rewrite(setup(), "  ")).toBe("and for last year's?");
    });

    test("a model call that fails falls back to the prompt and is reported with its code", async () => {
      const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
      // Nothing is enqueued: the FakeLLMClient throws
      const query = await rewrite(setup(), null);
      expect([query, String(report.mock.calls[0][0]).startsWith("Internal error 5372778284115: ")]).toEqual(["and for last year's?", true]);
    });
  });
});
