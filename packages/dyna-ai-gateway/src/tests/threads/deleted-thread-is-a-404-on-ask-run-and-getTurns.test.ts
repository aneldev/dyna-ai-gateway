import {AIGateway} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {makeDeleteScenario} from "../internal/utils/makeDeleteScenario";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigDelete} from "./delete.config";

/** A deleted thread is as good as one that never existed: `ask`, `run` and `getTurns` with its id are a 404 (D119, D32). */
test("a deleted thread is a 404 on ask, run and getTurns", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDelete, {llmClient: () => llmClient});
  const scenario = await makeDeleteScenario({
    gateway,
    llmClient,
  });
  const [own] = scenario.user;
  if (!own) throw new Error("Test setup: the scenario has two threads per user");
  await gateway.delete({
    tenantId: sampleUserContext.tenantId,
    threadIds: [own.threadId],
  });

  const outcomes = await Promise.allSettled([
    gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      threadId: own.threadId,
      prompt: "Still there?",
      kbFilters: noKb,
    }).response,
    gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      threadId: own.threadId,
      prompt: "Still there?",
      kbFilters: noKb,
    }).response,
    gateway.getTurns({
      userContext: sampleUserContext,
      threadId: own.threadId,
    }),
  ]);

  const notFound = {
    status: "rejected",
    reason: expect.objectContaining({status: 404}),
  };
  expect(outcomes).toEqual([notFound, notFound, notFound]);
});
