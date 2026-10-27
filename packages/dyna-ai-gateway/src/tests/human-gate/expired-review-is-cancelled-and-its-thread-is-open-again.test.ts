import {
  AIGateway,
  EGatewayResponseKind,
  ERunStatus,
  EThreadStatus,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  REVIEW_TIMEOUT_MS,
  gatewayConfigExpiringReview,
} from "./expiring-review.config";

/**
 * Nobody reviews the answer within the pause's limit (D99). The scheduled job (`expirePausedRuns`) cancels the run like an
 * expired approval; with no tool call to close, the answer is simply gone: no assistant turn, the run CANCELLED, the thread
 * open again.
 */
test("an expired review is cancelled by the job: the answer is dropped and the thread is open again", async () => {
  jest.useFakeTimers({doNotFake: ["nextTick", "setImmediate", "queueMicrotask"]});
  try {
    jest.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const llmClient = new FakeLLMClient();
    const gateway = new AIGateway(gatewayConfigExpiringReview, {llmClient: () => llmClient});
    llmClient.accountTo({
      trace: gateway.trace,
      usageGuard: gateway.usageGuard,
    });
    llmClient.enqueueRunStep({text: "It is noon."});
    const paused = await gateway.run({
      profileId: "default",
      userContext: {
        ...sampleUserContext,
        now: new Date(),
      },
      prompt: "What time is it?",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected a pause, got ${paused.kind}`);
    jest.setSystemTime(Date.now() + REVIEW_TIMEOUT_MS + 1);

    const expiredCount = await gateway.expirePausedRuns({tenantId: sampleUser.tenantId});

    const run = await gatewayConfigExpiringReview.runStore.repository.load({
      tenantId: sampleUser.tenantId,
      runId: paused.envelopes[0].runId,
    });
    const thread = await gatewayConfigExpiringReview.threadStore.repository.loadThread({
      tenantId: sampleUser.tenantId,
      threadId: paused.threadId,
    });
    const turns = await gatewayConfigExpiringReview.threadStore.repository.loadTurns({
      tenantId: sampleUser.tenantId,
      threadId: paused.threadId,
      desc: false,
      skip: 0,
      limit: 10,
    });
    expect([
      expiredCount,
      run?.status,
      thread?.status,
      turns.map(turn => turn.role),
    ]).toEqual([
      1,
      ERunStatus.CANCELLED,
      EThreadStatus.OPEN,
      [ETurnRole.USER],
    ]);
  }
  finally {
    jest.useRealTimers();
  }
});
