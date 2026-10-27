import {
  AIGateway,
  ERunStatus,
  EThreadStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {makeStuckRun} from "../internal/utils/makeStuckRun";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigStuckRun} from "./stuck-run.config";

/**
 * A RUNNING run whose thread is leased is a live call on another instance, not a stuck one: the job cannot take the
 * lease and leaves the run and the thread as they are (D97, D77).
 */
test("the recovery job leaves a running run alone while its thread holds a live lease", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigStuckRun, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const {
    runId,
    threadId,
  } = await makeStuckRun({
    gateway,
    llmClient,
    config: gatewayConfigStuckRun,
  });
  const tenantId = sampleUserContext.tenantId;
  const now = new Date();
  await gatewayConfigStuckRun.threadStore.repository.acquireLease({
    tenantId,
    threadId,
    token: "live-call",
    expiresAt: new Date(now.getTime() + 60_000),
    now,
  });

  const recovered = await gateway.recoverStuckRuns({tenantId});

  const run = await gatewayConfigStuckRun.runStore.repository.load({
    tenantId,
    runId,
  });
  const thread = await gatewayConfigStuckRun.threadStore.repository.loadThread({
    tenantId,
    threadId,
  });
  expect([
    recovered,
    run?.status,
    thread?.status,
    thread?.lease?.token,
  ]).toEqual([
    0,
    ERunStatus.RUNNING,
    EThreadStatus.AWAITING_HUMAN,
    "live-call",
  ]);
});
