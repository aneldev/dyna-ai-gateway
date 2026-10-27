import {
  TGatewayResponse,
  EGatewayResponseKind,
  EPauseKind,
  EResumeAction,
  EThreadStatus,
  ETraceKind,
  ETurnRole,
} from "../..";

import {
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {
  IToolGatewaySetup,
  loadTurns,
  makeCall,
  makeToolGateway,
} from "../internal/utils/makeToolGateway";

/** Scripts the model, then runs: getInvoice (no pause) → the given next steps. */
const run = (setup: IToolGatewaySetup, steps: Array<{toolCall?: ReturnType<typeof makeCall>; text?: string}>, threadId?: string): Promise<TGatewayResponse> => {
  steps.forEach(step => setup.llmClient.enqueueRunStep(step));
  return setup.gateway.run({
    profileId: "default",
    userContext,
    prompt: "refund invoice 4521",
    kbFilters: noKb,
    threadId,
  }).response;
};

describe("AIGateway — M2: run", () => {
  test("a run without tool requests answers like ask", async () => {
    const setup = await makeToolGateway();
    expect(await run(setup, [{text: "Nothing to do."}])).toMatchObject({
      kind: EGatewayResponseKind.ANSWER,
      text: "Nothing to do.",
    });
  });

  test("executes a tool without policy and does not pause (get_invoice)", async () => {
    const setup = await makeToolGateway();
    const response = await run(setup, [{toolCall: makeCall("get_invoice")}, {text: "The total is 30."}]);
    expect([response.kind, setup.executions.map(execution => execution.name)]).toEqual([EGatewayResponseKind.ANSWER, ["get_invoice"]]);
  });

  test("the tool runs with the validated input, the user and the thread of the call", async () => {
    const setup = await makeToolGateway();
    const response = await run(setup, [{toolCall: makeCall("get_invoice")}, {text: "done"}]);
    expect(setup.executions).toEqual([{
      name: "get_invoice",
      input: {invoiceId: "4521"},
      userId: "user-a",
      threadId: response.threadId,
    }]);
  });

  test("stores the turns of the run in order: user, tool request, tool result, answer", async () => {
    const setup = await makeToolGateway();
    const response = await run(setup, [{toolCall: makeCall("get_invoice")}, {text: "The total is 30."}]);
    expect((await loadTurns(setup, response.threadId ?? "")).map(turn => turn.role)).toEqual([
      ETurnRole.USER,
      ETurnRole.ASSISTANT,
      ETurnRole.TOOL,
      ETurnRole.ASSISTANT,
    ]);
  });

  test("pauses on a policy: NEEDS_APPROVAL tool with EPauseKind.TOOL_APPROVAL (refund)", async () => {
    const setup = await makeToolGateway();
    const response = await run(setup, [{toolCall: makeCall("get_invoice")}, {toolCall: makeCall("refund")}]);
    expect(response).toMatchObject({
      kind: EGatewayResponseKind.PAUSED,
      envelopes: [{
        kind: EPauseKind.TOOL_APPROVAL,
        toolCall: makeCall("refund"),
        allowed: [EResumeAction.APPROVE, EResumeAction.EDIT, EResumeAction.REJECT],
      }],
    });
  });

  test("a paused run has not executed the tool that waits for approval", async () => {
    const setup = await makeToolGateway();
    await run(setup, [{toolCall: makeCall("get_invoice")}, {toolCall: makeCall("refund")}]);
    expect(setup.executions.map(execution => execution.name)).toEqual(["get_invoice"]);
  });

  test("sets the thread to AWAITING_HUMAN when it pauses", async () => {
    const setup = await makeToolGateway();
    const response = await run(setup, [{toolCall: makeCall("refund")}]);
    const thread = await setup.config.threadStore.repository.loadThread({
      tenantId: "tenant-a",
      threadId: response.threadId ?? "",
    });
    expect(thread?.status).toBe(EThreadStatus.AWAITING_HUMAN);
  });

  test("listPausedRuns returns the paused run of the user", async () => {
    const setup = await makeToolGateway();
    const response = await run(setup, [{toolCall: makeCall("refund")}]);
    const runs = await setup.gateway.listPausedRuns({userContext});
    expect(runs.map(pausedRun => pausedRun.threadId)).toEqual([response.threadId]);
  });

  test("the thread shows the pending tool request while the run is paused", async () => {
    const setup = await makeToolGateway();
    const response = await run(setup, [{toolCall: makeCall("refund")}]);
    const turns = await loadTurns(setup, response.threadId ?? "");
    expect(turns[turns.length - 1].parts).toEqual([makeCall("refund")]);
  });

  test("rejects a run on a thread that is AWAITING_HUMAN, with a 409 and code 5372584062306", async () => {
    const setup = await makeToolGateway();
    const paused = await run(setup, [{toolCall: makeCall("refund")}]);
    await expect(run(setup, [{text: "never"}], paused.threadId)).rejects.toMatchObject({
      code: 5372584062306,
      status: 409,
    });
  });

  test("rejects an ask on a thread that is AWAITING_HUMAN as well", async () => {
    const setup = await makeToolGateway();
    const paused = await run(setup, [{toolCall: makeCall("refund")}]);
    await expect(setup.gateway.ask({
      profileId: "default",
      userContext,
      prompt: "hello",
      kbFilters: noKb,
      threadId: paused.threadId,
    }).response).rejects.toMatchObject({code: 5372584062306});
  });

  test("gives the LLMClient the profile's tools, its step limit and the kind RUN_STEP", async () => {
    const setup = await makeToolGateway();
    await run(setup, [{text: "done"}]);
    const call = setup.llmClient.runCalls[0];
    expect([call.tools.map(tool => tool.name), call.limits, call.meta.kind]).toEqual([["get_invoice", "refund"], {maxSteps: 5}, ETraceKind.RUN_STEP]);
  });

  test("a rejected prompt returns FAILED and does not reach the model", async () => {
    const setup = await makeToolGateway();
    const response = await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "  ",
      kbFilters: noKb,
    }).response;
    expect([response.kind, setup.llmClient.runCalls.length]).toEqual([EGatewayResponseKind.FAILED, 0]);
  });
});
