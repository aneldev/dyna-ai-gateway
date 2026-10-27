import {z} from "zod";

import {
  ILLMClientEvent,
  EGatewayResponseKind,
  ELLMClientEventKind,
  EResumeAction,
} from "../..";

import {
  makeGateway,
  makeModelResult,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {
  makeCall,
  makeToolGateway,
} from "../internal/utils/makeToolGateway";

const input = {
  profileId: "default",
  userContext,
  prompt: "refund invoice 4521",
  kbFilters: noKb,
};

const readEventKinds = async (events: AsyncIterable<ILLMClientEvent>): Promise<ELLMClientEventKind[]> => {
  const kinds: ELLMClientEventKind[] = [];
  for await (const event of events) kinds.push(event.kind);
  return kinds;
};

describe("AIGateway — D38: the call returns its stream", () => {
  test("ask streams the text, then DONE, in this order, and its response is the answer", async () => {
    const setup = await makeGateway();
    setup.llmClient.enqueueComplete(makeModelResult());
    const call = setup.gateway.ask(input);
    expect(await readEventKinds(call.events)).toEqual([ELLMClientEventKind.TEXT_DELTA, ELLMClientEventKind.DONE]);
    expect((await call.response).kind).toBe(EGatewayResponseKind.ANSWER);
  });

  test("a caller that never reads the events gets its response", async () => {
    const setup = await makeGateway();
    setup.llmClient.enqueueComplete(makeModelResult());
    await expect(setup.gateway.ask(input).response).resolves.toMatchObject({kind: EGatewayResponseKind.ANSWER});
  });

  test("an answer that fails the checks streams its text, then ANSWER_WITHDRAWN after DONE; its response is FAILED", async () => {
    const setup = await makeGateway();
    setup.llmClient.enqueueComplete(makeModelResult({text: "not what the schema asks for"}));
    const call = setup.gateway.ask({
      ...input,
      outputSchema: z.object({total: z.number()}),
    });
    expect(await readEventKinds(call.events)).toEqual([ELLMClientEventKind.TEXT_DELTA, ELLMClientEventKind.DONE, ELLMClientEventKind.ANSWER_WITHDRAWN]);
    expect((await call.response).kind).toBe(EGatewayResponseKind.FAILED);
  });

  test("a rejected prompt streams nothing and its response is FAILED", async () => {
    const setup = await makeGateway();
    const call = setup.gateway.ask({
      ...input,
      prompt: "   ",
    });
    expect([await readEventKinds(call.events), (await call.response).kind]).toEqual([[], EGatewayResponseKind.FAILED]);
  });

  test("a run streams the tool activity of its steps and its text", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({toolCall: makeCall("get_invoice")});
    setup.llmClient.enqueueRunStep({text: "The total is 30."});
    const call = setup.gateway.run(input);
    const kinds = await readEventKinds(call.events);
    expect([
      kinds.includes(ELLMClientEventKind.TOOL_REQUEST),
      kinds.includes(ELLMClientEventKind.TOOL_RESULT),
      kinds.includes(ELLMClientEventKind.TEXT_DELTA),
      (await call.response).kind,
    ]).toEqual([true, true, true, EGatewayResponseKind.ANSWER]);
  });

  test("a run that pauses streams RUN_PAUSED and its response is PAUSED", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    const call = setup.gateway.run(input);
    expect([(await readEventKinds(call.events)).includes(ELLMClientEventKind.RUN_PAUSED), (await call.response).kind]).toEqual([
      true,
      EGatewayResponseKind.PAUSED,
    ]);
  });

  test("a resume streams on its own call", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    const paused = await setup.gateway.run(input).response;
    setup.llmClient.enqueueRunStep({text: "Refunded."});
    const call = setup.gateway.resume({
      userContext,
      runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
      pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
      decisions: [{action: EResumeAction.APPROVE}],
    });
    const kinds = await readEventKinds(call.events);
    expect([
      kinds.includes(ELLMClientEventKind.TOOL_RESULT),
      kinds.includes(ELLMClientEventKind.TEXT_DELTA),
      (await call.response).kind,
    ]).toEqual([true, true, EGatewayResponseKind.ANSWER]);
  });

  test("an ask that throws rejects its response and ends its stream with the same error", async () => {
    const setup = await makeGateway();
    // Nothing is enqueued: the FakeLLMClient throws
    const call = setup.gateway.ask(input);
    await expect(call.response).rejects.toMatchObject({code: 5372567786040});
    await expect(readEventKinds(call.events)).rejects.toMatchObject({code: 5372567786040});
  });

  test("a run that throws rejects its response and ends its stream with the same error", async () => {
    const setup = await makeToolGateway();
    const call = setup.gateway.run(input);
    await expect(readEventKinds(call.events)).rejects.toMatchObject({code: 5372567786061});
    await expect(call.response).rejects.toMatchObject({code: 5372567786061});
  });
});
