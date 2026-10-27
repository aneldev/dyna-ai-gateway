import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  ERunStatus,
  EThreadStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  PAUSE_TIMEOUT_MS,
  countedRefundTool,
  gatewayConfigExpiringPause,
} from "./expiring-pause.config";

/** The job runs before the pause's limit: nothing is expired, the run stays PAUSED and the thread AWAITING_HUMAN (M6.7). */
test("a pause that is not yet due is left alone by the job", async () => {
  jest.useFakeTimers({doNotFake: ["nextTick", "setImmediate", "queueMicrotask"]});
  try {
    jest.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    const llmClient = new FakeLLMClient();
    const gateway = new AIGateway(gatewayConfigExpiringPause, {llmClient: () => llmClient});
    llmClient.accountTo({
      trace: gateway.trace,
      usageGuard: gateway.usageGuard,
    });
    llmClient.enqueueRunStep({
      toolCall: {
        kind: EPartKind.TOOL_CALL,
        callId: "call-1",
        toolName: countedRefundTool.name,
        input: {amount: 500},
      },
    });
    const paused = await gateway.run({
      profileId: "default",
      userContext: {
        ...sampleUserContext,
        now: new Date(),
      },
      prompt: "Refund 500",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) {
      throw dynaError({
        code: 5375197009119,
        message: `Test setup: expected PAUSED, got ${paused.kind}`,
        data: {paused},
      });
    }
    jest.setSystemTime(Date.now() + PAUSE_TIMEOUT_MS - 1_000);

    const expiredCount = await gateway.expirePausedRuns({tenantId: sampleUser.tenantId});

    const run = await gatewayConfigExpiringPause.runStore.repository.load({
      tenantId: sampleUser.tenantId,
      runId: paused.envelopes[0].runId,
    });
    const thread = await gatewayConfigExpiringPause.threadStore.repository.loadThread({
      tenantId: sampleUser.tenantId,
      threadId: paused.threadId,
    });
    expect([expiredCount, run?.status, thread?.status]).toEqual([0, ERunStatus.PAUSED, EThreadStatus.AWAITING_HUMAN]);
  }
  finally {
    jest.useRealTimers();
  }
});
