import {
  InMemoryPromptTemplateRepository,
  InMemoryUserMemoryRepository,
} from "../../../adapters/in-memory";
import {
  EPartKind,
  ETurnRole,
} from "../../../contracts";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {EFinishReason} from "../../llm-client";
import {PromptTemplateStore} from "../../prompt-template-store";
import {ETraceKind} from "../../trace";

import {UserMemoryStore} from "../UserMemoryStore";
import {EUserMemoryFactOp} from "../types";

/** The extractor's facts skip the check of `upsertFact`: a value the model wrote over `maxFactChars` is stored cut to it. */
test("extract stores a model-written value over maxFactChars cut to the cap", async () => {
  const llmClient = new FakeLLMClient();
  const store = new UserMemoryStore({
    repository: new InMemoryUserMemoryRepository(),
    enabled: true,
    maxFactChars: 20,
  }, {
    llmClient,
    promptTemplateStore: new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
  });
  const owner = {
    tenantId: "tenant-a",
    userId: "user-a",
  };
  const structured = {
    facts: [{
      key: "role",
      value: "y".repeat(100),
      op: EUserMemoryFactOp.SET,
    }],
  };
  llmClient.enqueueComplete({
    modelId: "cheap-model",
    text: JSON.stringify(structured),
    structured,
    toolCalls: [],
    finishReason: EFinishReason.STOP,
    usage: {
      inputTokens: 10,
      outputTokens: 2,
    },
    latencyMs: 1,
    traceId: "trace-1",
  }, ETraceKind.MEMORY_USER);

  await store.extract({
    ...owner,
    threadId: "thread-1",
    turns: [{
      id: "turn-1",
      role: ETurnRole.USER,
      parts: [{
        kind: EPartKind.TEXT,
        text: "I am an accountant",
      }],
      createdAt: new Date(1_000),
    }],
    cheapModelId: "cheap-model",
    meta: {
      ...owner,
      kind: ETraceKind.MEMORY_USER,
    },
  });

  const facts = await store.getFacts(owner);
  expect(facts.map(fact => fact.value)).toEqual(["y".repeat(20)]);
});
