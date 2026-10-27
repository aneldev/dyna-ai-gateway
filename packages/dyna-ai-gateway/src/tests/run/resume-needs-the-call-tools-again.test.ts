import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  cancelOrderTool,
  gatewayConfigCallTools,
} from "./call-tools.config";

/**
 * A call tool with `policy: NEEDS_APPROVAL` pauses like a registry tool. The run stores tool names only, so a resume without the call's
 * tools is a 400 and the run stays PAUSED; a resume with them again executes the tool and finishes (D66).
 */
test("a run paused on a call tool resumes only when the call's tools are passed again", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigCallTools, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: cancelOrderTool.name,
      input: {orderId: "A-1"},
    },
  });
  llmClient.enqueueRunStep({text: "Order A-1 is cancelled."});
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Cancel order A-1",
    kbFilters: noKb,
    additionalTools: [cancelOrderTool],
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5374506419237,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  const {
    runId,
    pauseId,
  } = paused.envelopes[0];
  const loadStatus = async (): Promise<ERunStatus | undefined> => (await gatewayConfigCallTools.runStore.repository.load({
    tenantId: sampleUserContext.tenantId,
    runId,
  }))?.status;

  const withoutTools = gateway.resume({
    userContext: sampleUserContext,
    runId,
    pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
  }).response;
  await expect(withoutTools).rejects.toMatchObject({
    status: 400,
    data: {missingTools: [cancelOrderTool.name]},
  });
  const statusAfterRefusal = await loadStatus();

  const response = await gateway.resume({
    userContext: sampleUserContext,
    runId,
    pauseId,
    decisions: [{action: EResumeAction.APPROVE}],
    additionalTools: [cancelOrderTool],
  }).response;

  const toolResults = await loadToolResults({
    config: gatewayConfigCallTools,
    threadId: paused.threadId,
  });
  expect([statusAfterRefusal, response.kind, await loadStatus(), toolResults.map(part => part.output)]).toEqual([
    ERunStatus.PAUSED,
    EGatewayResponseKind.ANSWER,
    ERunStatus.DONE,
    [{cancelled: "A-1"}],
  ]);
});
