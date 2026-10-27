import {
  IIssue,
  IUserContext,
} from "../../../contracts";

import {InMemoryModelRegistryRepository} from "../../../adapters/in-memory";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {IAIProfile} from "../../ai-profile-store";
import {ModelRegistry} from "../../model-registry";

import {Guardrails} from "../Guardrails";
import {IRuleErrorReport} from "../types";

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
 * The caller aborts while an input rule waits: the call ended, the rule did not fail, so `onRuleError` is not called.
 */
test("an abort of the call during a rule is not reported to onRuleError", async () => {
  const controller = new AbortController();
  const stopPressed = new Error("stop pressed");
  const reports: IRuleErrorReport[] = [];
  const guardrails = new Guardrails({
    ruleTimeoutMs: 10_000,
    inputRules: [{
      name: "slow",
      check: (): Promise<IIssue[]> => new Promise(() => {
        setTimeout(() => controller.abort(stopPressed), 10);
      }),
    }],
    onRuleError: (report): void => {
      reports.push(report);
    },
  }, deps);

  await expect(guardrails.checkInput({
    prompt: "hello",
    files: [],
    inlineFiles: [],
    userContext,
    profile,
    threadId: "thread-1",
    abortSignal: controller.signal,
  })).rejects.toBe(stopPressed);

  expect(reports).toEqual([]);
});
