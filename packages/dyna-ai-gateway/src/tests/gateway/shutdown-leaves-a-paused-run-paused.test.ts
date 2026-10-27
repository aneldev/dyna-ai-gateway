import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  ERunStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sendEmailTool} from "../internal/samples/tools";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigShutdown} from "./shutdown.config";

/** A run that waits for a human is stored, not in flight: the shutdown leaves it PAUSED for the next instance to resume (D96). */
test("shutdown leaves a paused run paused", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigShutdown, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: sendEmailTool.name,
      input: {
        to: "bob@example.com",
        subject: "Hi",
        body: "Hello",
      },
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Email Bob",
    kbFilters: noKb,
  }).response;

  await gateway.shutdown({timeoutMs: 100});
  const run = paused.kind === EGatewayResponseKind.PAUSED
    ? await gatewayConfigShutdown.runStore.repository.load({
      tenantId: sampleUserContext.tenantId,
      runId: paused.envelopes[0].runId,
    })
    : null;

  expect([
    paused.kind,
    run?.status,
  ]).toEqual([
    EGatewayResponseKind.PAUSED,
    ERunStatus.PAUSED,
  ]);
});
