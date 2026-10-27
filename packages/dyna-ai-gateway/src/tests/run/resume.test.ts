import {dynaError} from "dyna-error";

import {
  IPausedResponse,
  IResumeDecision,
  TGatewayResponse,
  DEFAULT_TOOL_REJECTION_TEXT,
  EGatewayResponseKind,
  EMessageRole,
  EResumeAction,
  ERunStatus,
  EThreadStatus,
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

interface IPausedSetup extends IToolGatewaySetup {
  paused: IPausedResponse;
}

/** A gateway whose run paused on refund; the script is empty, so a resume fails when the loop asks the model again. */
const makePausedWithoutNextStep = async (): Promise<IPausedSetup> => {
  const setup = await makeToolGateway();
  setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
  const response = await setup.gateway.run({
    profileId: "default",
    userContext,
    prompt: "refund invoice 4521",
    kbFilters: noKb,
  }).response;
  if (response.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5372585193960,
      message: `Test setup: expected PAUSED, got ${response.kind}`,
      data: {response},
    });
  }
  return {
    ...setup,
    paused: response,
  };
};

/** A gateway whose run paused on refund; the model's next scripted step is the final text. */
const makePaused = async (): Promise<IPausedSetup> => {
  const setup = await makePausedWithoutNextStep();
  setup.llmClient.enqueueRunStep({text: "Done."});
  return setup;
};

const resume = (setup: IPausedSetup, decision: IResumeDecision): Promise<TGatewayResponse> =>
  setup.gateway.resume({
    userContext,
    runId: setup.paused.envelopes[0].runId,
    pauseId: setup.paused.envelopes[0].pauseId,
    decisions: [decision],
  }).response;

const loadStatus = async (setup: IPausedSetup): Promise<[ERunStatus | undefined, EThreadStatus | undefined]> => {
  const run = await setup.config.runStore.repository.load({
    tenantId: "tenant-a",
    runId: setup.paused.envelopes[0].runId,
  });
  const thread = await setup.config.threadStore.repository.loadThread({
    tenantId: "tenant-a",
    threadId: setup.paused.threadId,
  });
  return [run?.status, thread?.status];
};

describe("AIGateway — M2: resume", () => {
  test("APPROVE executes the tool and finishes with the answer", async () => {
    const setup = await makePaused();
    const response = await resume(setup, {action: EResumeAction.APPROVE});
    expect([response.kind, setup.executions.map(execution => execution.name)]).toEqual([EGatewayResponseKind.ANSWER, ["refund"]]);
  });

  test("APPROVE stores the turns including the tool turns", async () => {
    const setup = await makePaused();
    await resume(setup, {action: EResumeAction.APPROVE});
    expect((await loadTurns(setup, setup.paused.threadId)).map(turn => turn.role)).toEqual([
      ETurnRole.USER,
      ETurnRole.ASSISTANT,
      ETurnRole.TOOL,
      ETurnRole.ASSISTANT,
    ]);
  });

  test("after a finished resume the run is DONE and the thread OPEN", async () => {
    const setup = await makePaused();
    await resume(setup, {action: EResumeAction.APPROVE});
    expect(await loadStatus(setup)).toEqual([ERunStatus.DONE, EThreadStatus.OPEN]);
  });

  test("REJECT does not execute the tool and still finishes with the answer", async () => {
    const setup = await makePaused();
    const response = await resume(setup, {
      action: EResumeAction.REJECT,
      text: "too expensive",
    });
    expect([response.kind, setup.executions]).toEqual([EGatewayResponseKind.ANSWER, []]);
  });

  test("REJECT gives the model a tool result with rejected: true and the composed rejection text", async () => {
    const setup = await makePaused();
    await resume(setup, {
      action: EResumeAction.REJECT,
      text: "too expensive",
    });
    const toolTurn = (await loadTurns(setup, setup.paused.threadId)).find(turn => turn.role === ETurnRole.TOOL);
    expect(toolTurn?.parts[0]).toMatchObject({
      rejected: true,
      output: `${DEFAULT_TOOL_REJECTION_TEXT} Reason: too expensive`,
    });
  });

  test("EDIT executes the tool with the edited input", async () => {
    const setup = await makePaused();
    await resume(setup, {
      action: EResumeAction.EDIT,
      editedInput: {invoiceId: "9999"},
    });
    expect(setup.executions.map(execution => execution.input)).toEqual([{invoiceId: "9999"}]);
  });

  test("a disallowed action throws the HumanGate's 400 and leaves the run paused", async () => {
    const setup = await makePaused();
    await expect(resume(setup, {action: EResumeAction.ANSWER})).rejects.toMatchObject({
      code: 5372577355281,
      status: 400,
    });
    expect(await loadStatus(setup)).toEqual([ERunStatus.PAUSED, EThreadStatus.AWAITING_HUMAN]);
  });

  test("an unknown run throws the RunStore's 404", async () => {
    const setup = await makePaused();
    await expect(setup.gateway.resume({
      userContext,
      runId: "missing",
      pauseId: "missing",
      decisions: [{action: EResumeAction.APPROVE}],
    }).response).rejects.toMatchObject({
      code: 5372577355245,
      status: 404,
    });
  });

  test("pauses again when the next tool needs approval, on the same run", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    const first = await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "refund two invoices",
      kbFilters: noKb,
    }).response;
    setup.llmClient.enqueueRunStep({
      toolCall: {
        ...makeCall("refund", "4522"),
        callId: "call-refund-2",
      },
    });
    const second = await setup.gateway.resume({
      userContext,
      runId: first.kind === EGatewayResponseKind.PAUSED ? first.envelopes[0].runId : "",
      pauseId: first.kind === EGatewayResponseKind.PAUSED ? first.envelopes[0].pauseId : "",
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;
    expect([
      second.kind,
      second.kind === EGatewayResponseKind.PAUSED && first.kind === EGatewayResponseKind.PAUSED ? second.envelopes[0].runId === first.envelopes[0].runId : false,
    ]).toEqual([EGatewayResponseKind.PAUSED, true]);
  });

  test("when the continuation fails, the error is thrown", async () => {
    const setup = await makePausedWithoutNextStep();
    await expect(resume(setup, {action: EResumeAction.APPROVE})).rejects.toThrow("none is enqueued");
  });

  test("when the continuation fails, the run is FAILED and the thread OPEN", async () => {
    const setup = await makePausedWithoutNextStep();
    await resume(setup, {action: EResumeAction.APPROVE}).catch(() => undefined);
    expect(await loadStatus(setup)).toEqual([ERunStatus.FAILED, EThreadStatus.OPEN]);
  });

  test("when the continuation fails, the pending tool request is closed in the thread with an error result", async () => {
    const setup = await makePausedWithoutNextStep();
    await resume(setup, {action: EResumeAction.APPROVE}).catch(() => undefined);
    const turns = await loadTurns(setup, setup.paused.threadId);
    expect(turns[turns.length - 1].parts[0]).toMatchObject({
      callId: "call-refund",
      output: {error: "The run failed before it completed"},
    });
  });
});

describe("AIGateway — M2: cancelRun", () => {
  test("sets the run to CANCELLED and the thread back to OPEN", async () => {
    const setup = await makePaused();
    await setup.gateway.cancelRun({
      userContext,
      runId: setup.paused.envelopes[0].runId,
    });
    expect(await loadStatus(setup)).toEqual([ERunStatus.CANCELLED, EThreadStatus.OPEN]);
  });

  test("closes the pending tool request in the thread with a rejected result", async () => {
    const setup = await makePaused();
    await setup.gateway.cancelRun({
      userContext,
      runId: setup.paused.envelopes[0].runId,
    });
    const turns = await loadTurns(setup, setup.paused.threadId);
    expect(turns[turns.length - 1].parts[0]).toMatchObject({
      callId: "call-refund",
      rejected: true,
    });
  });

  test("after a cancel the thread can be used again, and the model receives a complete history", async () => {
    const setup = await makePaused();
    await setup.gateway.cancelRun({
      userContext,
      runId: setup.paused.envelopes[0].runId,
    });
    await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "never mind",
      kbFilters: noKb,
      threadId: setup.paused.threadId,
    }).response;
    const messages = setup.llmClient.runCalls[setup.llmClient.runCalls.length - 1].request.messages;
    expect(messages.map(message => message.role)).toEqual([EMessageRole.USER, EMessageRole.ASSISTANT, EMessageRole.TOOL, EMessageRole.USER]);
  });

  test("no run is listed as paused after a cancel", async () => {
    const setup = await makePaused();
    await setup.gateway.cancelRun({
      userContext,
      runId: setup.paused.envelopes[0].runId,
    });
    expect(await setup.gateway.listPausedRuns({userContext})).toEqual([]);
  });
});
