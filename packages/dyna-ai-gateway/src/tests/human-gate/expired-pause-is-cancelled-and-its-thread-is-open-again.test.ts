import {dynaError} from "dyna-error";

import {
  AIGateway,
  DEFAULT_TOOL_REJECTION_TEXT,
  EGatewayResponseKind,
  EPartKind,
  ERunStatus,
  EThreadStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUser} from "../internal/samples/profiles";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  PAUSE_TIMEOUT_MS,
  countedRefundTool,
  gatewayConfigExpiringPause,
  refundExecutions,
} from "./expiring-pause.config";

/**
 * Nobody answers an approval within the pause's limit. The scheduled job (`expirePausedRuns`) cancels the run like a user
 * cancel: the run is CANCELLED, its tool call is closed as rejected in the thread, the thread is OPEN and takes a new call,
 * the tool never ran (M6.7, D75).
 */
test("an expired pause is cancelled by the job: tool call rejected in the thread, thread open again, tool never ran", async () => {
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
        code: 5375197009107,
        message: `Test setup: expected PAUSED, got ${paused.kind}`,
        data: {paused},
      });
    }
    jest.setSystemTime(Date.now() + PAUSE_TIMEOUT_MS + 1);

    const expiredCount = await gateway.expirePausedRuns({tenantId: sampleUser.tenantId});

    const run = await gatewayConfigExpiringPause.runStore.repository.load({
      tenantId: sampleUser.tenantId,
      runId: paused.envelopes[0].runId,
    });
    const thread = await gatewayConfigExpiringPause.threadStore.repository.loadThread({
      tenantId: sampleUser.tenantId,
      threadId: paused.threadId,
    });
    const toolResults = await loadToolResults({
      config: gatewayConfigExpiringPause,
      threadId: paused.threadId,
    });
    llmClient.enqueueRunStep({text: "How can I help?"});
    const next = await gateway.run({
      profileId: "default",
      userContext: {
        ...sampleUserContext,
        now: new Date(),
      },
      threadId: paused.threadId,
      prompt: "Never mind",
      kbFilters: noKb,
    }).response;
    expect([
      expiredCount,
      run?.status,
      thread?.status,
      toolResults.map(part => [part.callId, part.rejected ?? false, part.output]),
      next.kind,
      refundExecutions.count,
    ]).toEqual([
      1,
      ERunStatus.CANCELLED,
      EThreadStatus.OPEN,
      [["call-1", true, `${DEFAULT_TOOL_REJECTION_TEXT} Reason: The approval expired`]],
      EGatewayResponseKind.ANSWER,
      0,
    ]);
  }
  finally {
    jest.useRealTimers();
  }
});
