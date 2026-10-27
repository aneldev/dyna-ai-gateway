import {AIGateway} from "../..";
import {
  AIProfileStore,
  KbIngestor,
  ModelRegistry,
  PromptTemplateStore,
  ToolRegistry,
  Trace,
  UsageGuard,
} from "../../internal";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {makeGatewayConfig} from "../internal/utils/makeGatewayConfig";

// The flows have their own files: AIGateway.ask.test.ts, .ask.checks.test.ts, .run.test.ts, .resume.test.ts
describe("AIGateway", () => {
  describe("M1 — composition root", () => {
    const gateway = new AIGateway(makeGatewayConfig(), {llmClient: () => new FakeLLMClient()});

    test.each([
      ["modelRegistry", ModelRegistry],
      ["aiProfileStore", AIProfileStore],
      ["promptTemplateStore", PromptTemplateStore],
      ["toolRegistry", ToolRegistry],
      ["trace", Trace],
      ["usageGuard", UsageGuard],
      ["kbIngestor", KbIngestor],
    ] as const)("the getter %s returns the gateway's instance", (name, classRef) => {
      expect(gateway[name]).toBeInstanceOf(classRef);
    });

    test("a getter returns the same instance every time", () => {
      expect(gateway.modelRegistry).toBe(gateway.modelRegistry);
    });

    test("an override replaces the instance the gateway would create", () => {
      const modelRegistry = new ModelRegistry(makeGatewayConfig().modelRegistry);
      expect(new AIGateway(makeGatewayConfig(), {modelRegistry: () => modelRegistry}).modelRegistry).toBe(modelRegistry);
    });
  });

  describe("M7", () => {
    test.todo("the repository suites pass on Mongo");
    test.todo("the repository suites pass on Postgres");
    test.todo("the collection / table names of every adapter come from its config");
    test.todo("a search in a library of realistic size is measured on Atlas");
  });
});
