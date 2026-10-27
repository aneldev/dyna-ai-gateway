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
import {refundTool} from "../internal/samples/tools";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  CANCEL_REJECTION_TEXT,
  PAUSE_TIMEOUT_MS,
  cancelExecutions,
  cancelOrderTool,
  gatewayConfigParallelApprovals,
} from "./parallel-approvals.config";

/**
 * Nobody answers a pause of two envelopes in time. The job (`expirePausedRuns`) cancels the run and closes every pending call
 * in the thread as rejected, each with its own rejection text (D87): the refund's default, the cancellation's own. The thread
 * is OPEN again, neither tool ran.
 */
test("an expired pause with two calls closes both as rejected, each with its own rejection text", async () => {
  jest.useFakeTimers({doNotFake: ["nextTick", "setImmediate", "queueMicrotask"]});
  try {
    jest.setSystemTime(new Date("2026-10-20T10:00:00Z"));
    const llmClient = new FakeLLMClient();
    const gateway = new AIGateway(gatewayConfigParallelApprovals, {llmClient: () => llmClient});
    llmClient.accountTo({
      trace: gateway.trace,
      usageGuard: gateway.usageGuard,
    });
    llmClient.enqueueRunStep({
      toolCalls: [
        {
          kind: EPartKind.TOOL_CALL,
          callId: "call-1",
          toolName: refundTool.name,
          input: {amount: 500},
        },
        {
          kind: EPartKind.TOOL_CALL,
          callId: "call-2",
          toolName: cancelOrderTool.name,
          input: {orderId: "A-1"},
        },
      ],
    });
    const cancellationsBefore = cancelExecutions.count;
    const paused = await gateway.run({
      profileId: "default",
      userContext: {
        ...sampleUserContext,
        now: new Date(),
      },
      prompt: "Refund 500 and cancel order A-1",
      kbFilters: noKb,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) {
      throw dynaError({
        code: 5376681234549,
        message: `Test setup: expected PAUSED, got ${paused.kind}`,
        data: {paused},
      });
    }
    jest.setSystemTime(Date.now() + PAUSE_TIMEOUT_MS + 1);

    const expiredCount = await gateway.expirePausedRuns({tenantId: sampleUser.tenantId});

    const run = await gatewayConfigParallelApprovals.runStore.repository.load({
      tenantId: sampleUser.tenantId,
      runId: paused.envelopes[0].runId,
    });
    const thread = await gatewayConfigParallelApprovals.threadStore.repository.loadThread({
      tenantId: sampleUser.tenantId,
      threadId: paused.threadId,
    });
    const results = await loadToolResults({
      config: gatewayConfigParallelApprovals,
      threadId: paused.threadId,
    });
    expect([
      expiredCount,
      run?.status,
      thread?.status,
      results.map(part => [part.callId, part.rejected ?? false, part.output]),
      cancelExecutions.count - cancellationsBefore,
    ]).toEqual([
      1,
      ERunStatus.CANCELLED,
      EThreadStatus.OPEN,
      [
        ["call-1", true, `${DEFAULT_TOOL_REJECTION_TEXT} Reason: The approval expired`],
        ["call-2", true, `${CANCEL_REJECTION_TEXT} Reason: The approval expired`],
      ],
      0,
    ]);
  }
  finally {
    jest.useRealTimers();
  }
});
