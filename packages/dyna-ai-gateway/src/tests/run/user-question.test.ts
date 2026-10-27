import {dynaError} from "dyna-error";

import {
  IUserAnswer,
  IPausedResponse,
  IToolCallPart,
  TGatewayResponse,
  EUserQuestionMode,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
  ERunStatus,
} from "../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../internal";

import {
  IGatewaySetup,
  makeGateway,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";

/**
 * The user-question pause by example (D62): the model calls the built-in `ask_user_question` tool with its questions, the run pauses with a
 * CLARIFICATION envelope, the user's answers go in through `resume` with ANSWER and reach the model as the tool's result.
 */

const userQuestions = {
  title: "Which invoice?",
  description: "Two invoices are overdue.",
  questions: [{
    text: "Pick the invoice",
    mode: EUserQuestionMode.RADIO,
    options: ["4521", "4522"],
    freeOption: true,
  }],
};

const answers: IUserAnswer[] = [{
  question: "Pick the invoice",
  selected: ["4521"],
}];

const askUserCall: IToolCallPart = {
  kind: EPartKind.TOOL_CALL,
  callId: "call-ask",
  toolName: ASK_USER_QUESTION_TOOL_NAME,
  input: userQuestions,
};

const makeUserQuestionGateway = (enabled = true): Promise<IGatewaySetup> =>
  makeGateway({humanGate: {userQuestions: {enabled}}});

/** The model asks the user, then answers with the invoice. */
const askWhichInvoice = (setup: IGatewaySetup): Promise<TGatewayResponse> => {
  setup.llmClient.enqueueRunStep({toolCall: askUserCall});
  setup.llmClient.enqueueRunStep({text: "Invoice 4521 is sent."});
  return setup.gateway.run({
    profileId: "default",
    userContext,
    prompt: "send the overdue invoice",
    kbFilters: noKb,
  }).response;
};

const pauseForUserQuestion = async (setup: IGatewaySetup): Promise<IPausedResponse> => {
  const response = await askWhichInvoice(setup);
  if (response.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5372634117695,
      message: `Test setup: expected PAUSED, got ${response.kind}`,
      data: {response},
    });
  }
  return response;
};

describe("AIGateway — user-question pause (D62)", () => {
  test("ask_user_question is offered to the model without being in the profile's allowedTools", async () => {
    const setup = await makeUserQuestionGateway();
    await askWhichInvoice(setup);
    expect(setup.llmClient.runCalls[0]?.tools.map(tool => tool.name)).toContain(ASK_USER_QUESTION_TOOL_NAME);
  });

  test("an ask_user_question call pauses the run with a CLARIFICATION envelope that allows ANSWER only", async () => {
    const setup = await makeUserQuestionGateway();
    const {envelopes: [envelope]} = await pauseForUserQuestion(setup);
    expect(envelope).toMatchObject({
      kind: EPauseKind.USER_QUESTION,
      userQuestions,
      allowed: [EResumeAction.ANSWER],
    });
  });

  test("ANSWER resumes the run: the answers reach the model as the tool result and the run finishes", async () => {
    const setup = await makeUserQuestionGateway();
    const {envelopes: [envelope]} = await pauseForUserQuestion(setup);
    const response = await setup.gateway.resume({
      userContext,
      runId: envelope.runId,
      pauseId: envelope.pauseId,
      decisions: [{
        action: EResumeAction.ANSWER,
        answers,
      }],
    }).response;
    const resumeMessages = setup.llmClient.runCalls[1]?.resume?.messages ?? [];
    const lastRunCall = setup.llmClient.runCalls[setup.llmClient.runCalls.length - 1];
    expect([response.kind, response.kind === EGatewayResponseKind.ANSWER && response.text]).toEqual([
      EGatewayResponseKind.ANSWER,
      "Invoice 4521 is sent.",
    ]);
    expect(resumeMessages.length).toBeGreaterThan(0);
    expect(lastRunCall?.resume?.decisions).toEqual([{
      action: EResumeAction.ANSWER,
      answers,
    }]);
  });

  test("APPROVE is refused for a user question and leaves the run paused", async () => {
    const setup = await makeUserQuestionGateway();
    const {envelopes: [envelope]} = await pauseForUserQuestion(setup);
    await expect(setup.gateway.resume({
      userContext,
      runId: envelope.runId,
      pauseId: envelope.pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
    }).response).rejects.toMatchObject({
      code: 5372577355281,
      status: 400,
    });
    const run = await setup.config.runStore.repository.load({
      tenantId: userContext.tenantId,
      runId: envelope.runId,
    });
    expect([run?.status, run?.pending?.[0]?.kind]).toEqual([ERunStatus.PAUSED, EPauseKind.USER_QUESTION]);
  });

  test("ask_user_question is absent when the userQuestions switch is off", async () => {
    const setup = await makeUserQuestionGateway(false);
    setup.llmClient.enqueueRunStep({text: "Done."});
    await setup.gateway.run({
      profileId: "default",
      userContext,
      prompt: "send the overdue invoice",
      kbFilters: noKb,
    }).response;
    expect(setup.llmClient.runCalls[0]?.tools.map(tool => tool.name)).not.toContain(ASK_USER_QUESTION_TOOL_NAME);
  });
});
