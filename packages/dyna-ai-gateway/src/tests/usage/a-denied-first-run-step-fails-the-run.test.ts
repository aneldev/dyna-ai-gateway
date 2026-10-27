import {
  AIGateway,
  EGatewayResponseKind,
  ERunStatus,
  ETraceKind,
  USAGE_DENIED_ISSUE_CODE,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {
  gatewayConfigDenyFirstRunStep,
  usageAdapterDenyingFirstRunStep,
} from "./denied.config";

/**
 * The app says no before the first step of a run: nothing has happened yet, so the run is FAILED with `usage_denied` as an ask
 * would be; no run record exists, no tool ran, nothing is reported to the adapter.
 */
test("a first run step the app refuses fails the run with usage_denied and leaves no run record", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigDenyFirstRunStep, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  const response = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it?",
    kbFilters: noKb,
  }).response;

  const runs = (await Promise.all(Object.values(ERunStatus).map(status => gatewayConfigDenyFirstRunStep.runStore.repository.listByStatus({
    tenantId: sampleUserContext.tenantId,
    status,
  })))).flat();
  expect([
    response.kind,
    response.kind === EGatewayResponseKind.FAILED && response.issues.map(issue => [issue.code, issue.data]),
    runs.length,
    usageAdapterDenyingFirstRunStep.checkCalls.map(call => call.kind),
    usageAdapterDenyingFirstRunStep.addUsageCalls.length,
  ]).toEqual([
    EGatewayResponseKind.FAILED,
    [[USAGE_DENIED_ISSUE_CODE, {denyCode: "plan_exhausted"}]],
    0,
    [ETraceKind.RUN_STEP],
    0,
  ]);
});
