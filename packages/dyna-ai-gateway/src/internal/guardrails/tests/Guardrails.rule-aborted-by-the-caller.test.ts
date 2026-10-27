import {
  IIssue,
  IUserContext,
} from "../../../contracts";

import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {IAIProfile} from "../../ai-profile-store";
import {ModelRegistry} from "../../model-registry";

import {Guardrails} from "../Guardrails";

const userContext: IUserContext = {
  tenantId: "tenant-a",
  userId: "user-a",
  permissions: [],
  locale: "en-US",
  timezone: "UTC",
  now: new Date("2026-10-14T00:00:00Z"),
};

const profile: IAIProfile = {
  id: "profile-1",
  tenantId: "tenant-a",
  name: "Default",
  modelId: "model-a",
  allowedTools: [],
  approvals: [],
  promptAddendum: "",
  limits: {
    maxStepsPerRun: 5,
    maxOutputTokens: 100,
  },
};

/** No judge call is scripted: the rule of this test never asks the model. */
const deps = {
  llmClient: new FakeLLMClient(),
  modelRegistry: new ModelRegistry({repository: new InMemoryModelRegistryRepository()}),
};

/**
 * The caller aborts while an input rule waits (a slow judge service). The check rejects with the caller's reason at once:
 * not a `rule_error` issue (the rule did not fail, the call ended), nothing logged, and the rule's own signal is aborted
 * so a judge call in flight ends too.
 */
test("an abort of the call during a rule rejects the check with the caller's reason, no rule_error, no log", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const controller = new AbortController();
  const stopPressed = new Error("stop pressed");
  let ruleSignal: AbortSignal | undefined;
  const guardrails = new Guardrails({
    ruleTimeoutMs: 10_000,
    inputRules: [{
      name: "slow",
      check: ({abortSignal}): Promise<IIssue[]> => new Promise(() => {
        ruleSignal = abortSignal;
        setTimeout(() => controller.abort(stopPressed), 10);
      }),
    }],
  }, deps);
  const startedAt = Date.now();

  await expect(guardrails.checkInput({
    prompt: "hello",
    files: [],
    inlineFiles: [],
    userContext,
    profile,
    threadId: "thread-1",
    abortSignal: controller.signal,
  })).rejects.toBe(stopPressed);

  expect([Date.now() - startedAt < 1_000, ruleSignal?.aborted, log.mock.calls.length]).toEqual([true, true, 0]);
  log.mockRestore();
});
