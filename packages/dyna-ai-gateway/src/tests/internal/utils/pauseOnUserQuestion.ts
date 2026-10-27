import {
  AIGateway,
  IPausedResponse,
  IUserQuestions,
  EGatewayResponseKind,
  EPartKind,
} from "../../..";
import {ASK_USER_QUESTION_TOOL_NAME} from "../../../internal";

import {FakeLLMClient} from "../fakes/FakeLLMClient";

import {noKb} from "./makeGateway";
import {sampleUserContext} from "./sampleUserContext";

/** A run of the sample user whose model asks `questions` through `ask_user_question`: the PAUSED response with that card. Wires the fake's accounting. */
export const pauseOnUserQuestion = async (
  {
    gateway,
    llmClient,
    questions,
  }: {
    gateway: AIGateway;
    llmClient: FakeLLMClient;
    questions: IUserQuestions;
  },
): Promise<IPausedResponse> => {
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-ask",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      input: questions,
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Send the overdue invoice",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) throw new Error(`Test setup: expected PAUSED, got ${paused.kind}`);
  return paused;
};
