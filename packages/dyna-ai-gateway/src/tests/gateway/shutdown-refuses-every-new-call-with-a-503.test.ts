import {
  AIGateway,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigShutdown} from "./shutdown.config";

/**
 * Once `shutdown` began, `ask`, `run` and `resume` are refused with a 503 (D96): not a 4xx, the client did nothing wrong and
 * may retry on another instance. The model is never called. A second `shutdown` returns the same promise.
 */
test("after shutdown every new ask, run and resume is a 503, and a second shutdown is the same promise", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigShutdown, {llmClient: () => llmClient});
  const first = gateway.shutdown({timeoutMs: 1_000});
  const second = gateway.shutdown({timeoutMs: 5});
  await first;

  const outcomes = await Promise.allSettled([
    gateway.ask({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Hi",
      kbFilters: noKb,
    }).response,
    gateway.run({
      profileId: "default",
      userContext: sampleUserContext,
      prompt: "Hi",
      kbFilters: noKb,
    }).response,
    gateway.resume({
      userContext: sampleUserContext,
      runId: "run-1",
      pauseId: "pause-1",
      decisions: [{action: EResumeAction.APPROVE}],
    }).response,
  ]);

  const unavailable = {
    status: "rejected",
    reason: expect.objectContaining({
      code: 5377780695122,
      status: 503,
    }),
  };
  expect([
    outcomes,
    second === first,
    llmClient.completeCalls.length + llmClient.runCalls.length,
  ]).toEqual([
    [unavailable, unavailable, unavailable],
    true,
    0,
  ]);
});
