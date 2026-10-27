import {
  AIGateway,
  EGatewayResponseKind,
  ERunStatus,
  EThreadStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * The review comes after the output checks (D99): an answer a rule blocks is FAILED as on any profile, no run is stored for a
 * reviewer and the thread stays open. The reviewer only ever sees what the end user could have received.
 */
test("an answer the output rules block is FAILED and never reaches a reviewer", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigReviewAnswers, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "The SECRET is 42."});

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Tell me.",
    kbFilters: noKb,
  }).response;

  const pausedRuns = await gatewayConfigReviewAnswers.runStore.repository.listByStatus({
    tenantId: sampleUser.tenantId,
    status: ERunStatus.PAUSED,
  });
  const thread = await gatewayConfigReviewAnswers.threadStore.repository.loadThread({
    tenantId: sampleUser.tenantId,
    threadId: response.threadId ?? "",
  });

  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED ? response.issues.map(issue => issue.code) : null,
    pausedRuns.length,
    thread?.status,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    ["leak"],
    0,
    EThreadStatus.OPEN,
  ]);
});
