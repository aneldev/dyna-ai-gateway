import {dynaError} from "dyna-error";

import {
  AIGateway,
  IPausedResponse,
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
} from "./expiring-pause.config";
import {
  brokenThreadIds,
  gatewayConfigExpiryJobBrokenThread,
} from "./expiry-job-skips-a-thread-it-cannot-close.config";

/**
 * Two expired pauses; the first thread cannot take the closing turn. The job logs it and goes on: the second run is closed
 * (thread OPEN), the count says one, both runs are CANCELLED, the broken thread stays AWAITING_HUMAN (D76).
 */
test("the expiry job logs a thread it cannot close and still closes the others", async () => {
  jest.useFakeTimers({doNotFake: ["nextTick", "setImmediate", "queueMicrotask"]});
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    jest.setSystemTime(new Date("2026-10-11T10:00:00Z"));
    const llmClient = new FakeLLMClient();
    const gateway = new AIGateway(gatewayConfigExpiryJobBrokenThread, {llmClient: () => llmClient});
    llmClient.accountTo({
      trace: gateway.trace,
      usageGuard: gateway.usageGuard,
    });
    const pauseOnRefund = async (): Promise<IPausedResponse> => {
      llmClient.enqueueRunStep({
        toolCall: {
          kind: EPartKind.TOOL_CALL,
          callId: "call-1",
          toolName: countedRefundTool.name,
          input: {amount: 500},
        },
      });
      const response = await gateway.run({
        profileId: "default",
        userContext: {
          ...sampleUserContext,
          now: new Date(),
        },
        prompt: "Refund 500",
        kbFilters: noKb,
      }).response;
      if (response.kind !== EGatewayResponseKind.PAUSED) {
        throw dynaError({
          code: 5375202005337,
          message: `Test setup: expected PAUSED, got ${response.kind}`,
          data: {response},
        });
      }
      return response;
    };
    const first = await pauseOnRefund();
    const second = await pauseOnRefund();
    brokenThreadIds.add(first.threadId);
    jest.setSystemTime(Date.now() + PAUSE_TIMEOUT_MS + 1);

    const closedCount = await gateway.expirePausedRuns({tenantId: sampleUser.tenantId});

    const {repository: runs} = gatewayConfigExpiryJobBrokenThread.runStore;
    const {repository: threads} = gatewayConfigExpiryJobBrokenThread.threadStore;
    const statuses = await Promise.all([
      runs.load({
        tenantId: sampleUser.tenantId,
        runId: first.envelopes[0].runId,
      }),
      runs.load({
        tenantId: sampleUser.tenantId,
        runId: second.envelopes[0].runId,
      }),
      threads.loadThread({
        tenantId: sampleUser.tenantId,
        threadId: first.threadId,
      }),
      threads.loadThread({
        tenantId: sampleUser.tenantId,
        threadId: second.threadId,
      }),
    ]);
    expect([
      closedCount,
      statuses.map(record => record?.status),
      consoleError.mock.calls.length,
    ]).toEqual([
      1,
      [ERunStatus.CANCELLED, ERunStatus.CANCELLED, EThreadStatus.AWAITING_HUMAN, EThreadStatus.OPEN],
      1,
    ]);
  }
  finally {
    consoleError.mockRestore();
    brokenThreadIds.clear();
    jest.useRealTimers();
  }
});
