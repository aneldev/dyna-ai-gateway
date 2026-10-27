import {
  EGatewayResponseKind,
  EMessageRole,
  EResumeAction,
  ERunStatus,
} from "../..";

import {
  makeModelResult,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {
  makeCall,
  makeToolGateway,
} from "../internal/utils/makeToolGateway";

describe("AIGateway — debug: the transcript on the answer (D63)", () => {
  test("run with debug: true returns the system prompt, every message of the loop and the step count", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({text: "done"});
    const response = await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "show invoice 4521",
      kbFilters: noKb,
      debug: true,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
    if (!response.debug) throw new Error("Expected debug on the answer");
    expect(typeof response.debug.system).toBe("string");
    expect(response.debug.steps).toBeGreaterThan(0);
    expect(response.debug.messages.map(message => message.role)).toContain(EMessageRole.ASSISTANT);
  });

  test("ask with debug: true returns the request messages plus the reply, with one step", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueComplete(makeModelResult({text: "Hello."}));
    const response = await setup.gateway.ask({
      profileId: "default",
      userContext,
      prompt: "hello",
      kbFilters: noKb,
      debug: true,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
    expect(response.debug?.steps).toBe(1);
    const last = response.debug?.messages.at(-1);
    expect(last?.role).toBe(EMessageRole.ASSISTANT);
  });

  test("resume with debug: true returns the stored run, settled as DONE", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    setup.llmClient.enqueueRunStep({text: "Done."});
    const paused = await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "refund invoice 4521",
      kbFilters: noKb,
      debug: true,
    }).response;
    if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Expected PAUSED, got ${paused.kind}`);
    const response = await setup.gateway.resume({
      userContext,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
      debug: true,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
    expect([response.debug?.run?.id, response.debug?.run?.status, response.debug?.run?.toolNames]).toEqual([
      paused.envelopes[0].runId,
      ERunStatus.DONE,
      ["get_invoice", "refund"],
    ]);
  });

  test("a run() that finishes without pausing has no run in debug", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({text: "done"});
    const response = await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "show invoice 4521",
      kbFilters: noKb,
      debug: true,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
    expect(response.debug?.run).toBeUndefined();
  });

  test("without debug the answer carries no transcript", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueComplete(makeModelResult({text: "Hello."}));
    const response = await setup.gateway.ask({
      profileId: "default",
      userContext,
      prompt: "hello",
      kbFilters: noKb,
    }).response;
    if (response.kind !== EGatewayResponseKind.ANSWER) throw new Error(`Expected ANSWER, got ${response.kind}`);
    expect("debug" in response).toBe(false);
  });
});
