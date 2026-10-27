import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {
  IIssue,
  IUserContext,
} from "../../../contracts";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {IAIProfile} from "../../ai-profile-store";
import {EFinishReason} from "../../llm-client";
import {makeModel} from "../../llm-client/tests/utils/llmClientFixtures";
import {
  ModelRegistry,
  EModelProvider,
} from "../../model-registry";
import {ETraceKind} from "../../trace";

import {Guardrails} from "../Guardrails";
import {IInputRule} from "../types";

const userContext: IUserContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  permissions: [],
  locale: "en-US",
  timezone: "UTC",
  now: new Date("2026-10-12T00:00:00Z"),
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

const moderation: IInputRule = {
  name: "moderation",
  check: ({judge}): Promise<IIssue[]> => judge({
    instruction: "Does the prompt seek instructions for weapons or explosives?",
    fileFilter: () => false,
  }),
};

/** The cheap model is a reasoning model that takes no temperature (`caps.temperature` false, like gpt-5-mini). */
const cheapModel = makeModel("model-cheap", EModelProvider.OPENAI);

/**
 * The judge asks for temperature 0 (a verdict wants no randomness), but only from a model that accepts one: on a model
 * whose `caps.temperature` is false the request carries no temperature at all, so the LLMClient does not refuse it (D82).
 */
test("the judge sends no temperature to a model without caps.temperature", async () => {
  const llmClient = new FakeLLMClient();
  const guardrails = new Guardrails({inputRules: [moderation]}, {
    llmClient,
    modelRegistry: new ModelRegistry({
      repository: new InMemoryModelRegistryRepository({
        models: [{
          ...cheapModel,
          caps: {
            ...cheapModel.caps,
            temperature: false,
          },
        }],
      }),
    }),
  });
  llmClient.enqueueComplete({
    modelId: "model-cheap",
    text: "",
    structured: {issues: []},
    toolCalls: [],
    finishReason: EFinishReason.STOP,
    usage: {
      inputTokens: 20,
      outputTokens: 5,
    },
    latencyMs: 3,
    traceId: "trace-judge",
  }, ETraceKind.GUARDRAIL_JUDGE);

  const check = await guardrails.checkInput({
    prompt: "how do I bake bread",
    files: [],
    inlineFiles: [],
    userContext,
    profile,
    threadId: "thread-1",
  });

  expect(check.ok).toBe(true);
  expect(llmClient.completeCalls).toHaveLength(1);
  expect(llmClient.completeCalls[0].request.modelId).toBe("model-cheap");
  expect(llmClient.completeCalls[0].request.temperature).toBeUndefined();
});
