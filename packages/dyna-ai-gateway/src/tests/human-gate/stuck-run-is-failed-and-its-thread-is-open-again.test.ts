import {
  AIGateway,
  EGatewayResponseKind,
  ERunStatus,
  EThreadStatus,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {makeStuckRun} from "../internal/utils/makeStuckRun";
import {loadToolResults} from "../internal/utils/loadToolResults";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigStuckRun,
  refundExecutions,
} from "./stuck-run.config";

/**
 * An instance died inside `resume`: the run is RUNNING, the thread AWAITING_HUMAN, and no door reopens it. The job
 * (`recoverStuckRuns`) takes the free lease, fails the run, answers the cut tool call with an error in the thread and opens
 * the thread; the tool never ran; a second job finds nothing (D97).
 */
test("a stuck run is failed by the job: tool call closed with an error, thread open again, nothing left for a second job", async () => {
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

  const recovered = await gateway.recoverStuckRuns({tenantId});
  const recoveredAgain = await gateway.recoverStuckRuns({tenantId});

  const run = await gatewayConfigStuckRun.runStore.repository.load({
    tenantId,
    runId,
  });
  const thread = await gatewayConfigStuckRun.threadStore.repository.loadThread({
    tenantId,
    threadId,
  });
  const toolResults = await loadToolResults({
    config: gatewayConfigStuckRun,
    threadId,
  });
  llmClient.enqueueRunStep({text: "How can I help?"});
  const next = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    threadId,
    prompt: "Never mind",
    kbFilters: noKb,
  }).response;
  expect([
    [recovered, recoveredAgain],
    run?.status,
    thread?.status,
    thread?.lease,
    toolResults.map(part => [part.callId, part.failed ?? false, part.output]),
    next.kind,
    refundExecutions.count,
  ]).toEqual([
    [1, 0],
    ERunStatus.FAILED,
    EThreadStatus.OPEN,
    null,
    [["call-1", true, {error: "The call was cut off: the server stopped before it finished"}]],
    EGatewayResponseKind.ANSWER,
    0,
  ]);
});
