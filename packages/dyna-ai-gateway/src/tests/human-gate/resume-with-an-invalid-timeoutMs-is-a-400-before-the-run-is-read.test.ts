import {
  AIGateway,
  EResumeAction,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigAbortedResume} from "./aborted-resume.config";

/**
 * A `timeoutMs` of 0 on a resume is a developer error: the call rejects with the 400 of the deadline before the run is read (a run
 * that does not exist would be a 404 otherwise).
 */
test("a resume with timeoutMs 0 rejects with a 400 before the run is read", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigAbortedResume, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });

  await expect(gateway.resume({
    userContext: sampleUserContext,
    runId: "no-such-run",
    pauseId: "no-such-pause",
    decisions: [{action: EResumeAction.APPROVE}],
    timeoutMs: 0,
  }).response).rejects.toMatchObject({
    status: 400,
    code: 5376312450001,
  });
});
