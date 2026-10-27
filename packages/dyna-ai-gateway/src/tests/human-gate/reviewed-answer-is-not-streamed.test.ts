import {
  AIGateway,
  EGatewayResponseKind,
  ELLMClientEventKind,
  ILLMClientEvent,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {noKb} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigReviewAnswers} from "./review-answers.config";

/**
 * A reviewed answer reaches nobody before the reviewer (D99): on a profile with `reviewAnswers` the model's text is not
 * streamed, so a client that renders the stream shows no draft. The call's other events still arrive.
 */
test("a run on a reviewing profile streams no text: its events end with RUN_PAUSED and carry no TEXT_DELTA", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigReviewAnswers, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueRunStep({text: "Your order arrives Thursday."});

  const call = gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "When does my order arrive?",
    kbFilters: noKb,
  });
  const events: ILLMClientEvent[] = [];
  for await (const event of call.events) events.push(event);
  const response = await call.response;

  expect([
    response.kind,
    events.some(event => event.kind === ELLMClientEventKind.TEXT_DELTA),
    events.at(-1)?.kind,
  ]).toEqual([EGatewayResponseKind.PAUSED, false, ELLMClientEventKind.RUN_PAUSED]);
});
