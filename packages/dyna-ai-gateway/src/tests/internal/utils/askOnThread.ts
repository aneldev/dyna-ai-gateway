import {dynaError} from "dyna-error";

import {
  IAnswerResponse,
  AIGateway,
  EGatewayResponseKind,
} from "../../..";

import {FakeLLMClient} from "../fakes/FakeLLMClient";
import {openAiModel} from "../samples/models";

import {
  makeModelResult,
  noKb,
} from "./makeGateway";
import {sampleUserContext} from "./sampleUserContext";

/**
 * One `ask` of `sampleUserContext` with the model's answer scripted and `debug: true`, so the test reads the messages the model saw.
 * Waits for the background work (the memory). Throws when the response is not an ANSWER: the test's arrangement is broken then.
 */
export const askOnThread = async (
  {
    gateway,
    llmClient,
    prompt,
    answer = "The answer",
    threadId,
    profileId = "default",
  }: {
    gateway: AIGateway;
    llmClient: FakeLLMClient;
    prompt: string;
    answer?: string;
    threadId?: string;
    profileId?: string;
  },
): Promise<IAnswerResponse> => {
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: answer,
  }));
  const response = await gateway.ask({
    profileId,
    userContext: sampleUserContext,
    threadId,
    prompt,
    kbFilters: noKb,
    debug: true,
  }).response;
  await gateway.whenIdle();
  if (response.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5377220486101,
      message: `Test setup: expected ANSWER, got ${response.kind}`,
      data: {response},
    });
  }
  return response;
};
