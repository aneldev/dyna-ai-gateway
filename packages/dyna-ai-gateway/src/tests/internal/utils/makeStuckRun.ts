import {dynaError} from "dyna-error";

import {
  IAIGatewayConfig,
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  ERunStatus,
} from "../../..";

import {countedRefundTool} from "../../human-gate/stuck-run.config";

import {FakeLLMClient} from "../fakes/FakeLLMClient";

import {noKb} from "./makeGateway";
import {sampleUserContext} from "./sampleUserContext";

/**
 * A run as a dead instance leaves it after `resume` (D97): PAUSED on a refund approval, then moved to RUNNING in the store
 * exactly as `HumanGate.resume` does, its thread still AWAITING_HUMAN. Returns the run id and thread id.
 */
export const makeStuckRun = async (
  {
    gateway,
    llmClient,
    config,
  }: {
    gateway: AIGateway;
    llmClient: FakeLLMClient;
    config: IAIGatewayConfig;
  },
): Promise<{runId: string; threadId: string}> => {
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
    userContext: sampleUserContext,
    prompt: "Refund 500",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5375197009118,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const runId = paused.envelopes[0].runId;
  await config.runStore.repository.transition({
    tenantId: sampleUserContext.tenantId,
    runId,
    from: ERunStatus.PAUSED,
    to: ERunStatus.RUNNING,
  });
  return {
    runId,
    threadId: paused.threadId,
  };
};
