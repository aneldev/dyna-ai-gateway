import {dynaError} from "dyna-error";

import {
  IAnswerResponse,
  ITurn,
  EGatewayResponseKind,
  EMessageRole,
  ETraceKind,
  ETurnRole,
  joinSystem,
} from "../..";

import {
  IGatewaySetup,
  makeGateway,
  makeModelResult,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";

const ask = async (
  {
    gateway,
    llmClient,
  }: IGatewaySetup,
  prompt: string,
  extra: {threadId?: string; profileId?: string} = {},
): Promise<IAnswerResponse> => {
  llmClient.enqueueComplete(makeModelResult({text: `Answer to: ${prompt}`}));
  const response = await gateway.ask({
    profileId: "default",
    userContext,
    prompt,
    kbFilters: noKb,
    ...extra,
  }).response;
  if (response.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5372585193828,
      message: `Test setup: expected an ANSWER, got ${response.kind}`,
      data: {response},
    });
  }
  return response;
};

const loadTurns = (setup: IGatewaySetup, threadId: string): Promise<ITurn[]> =>
  setup.config.threadStore.repository.loadTurns({
    tenantId: "tenant-a",
    threadId,
    desc: false,
    skip: 0,
    limit: 100,
  });

describe("AIGateway — M1: ask", () => {
  test("returns the answer text", async () => {
    const setup = await makeGateway();
    expect((await ask(setup, "hello")).text).toBe("Answer to: hello");
  });

  test("returns the usage of the model call", async () => {
    const setup = await makeGateway();
    expect((await ask(setup, "hello")).usage).toEqual({
      inputTokens: 10,
      outputTokens: 2,
    });
  });

  test("creates a thread when no threadId is given and returns its id", async () => {
    const setup = await makeGateway();
    const response = await ask(setup, "hello");
    const thread = await setup.config.threadStore.repository.loadThread({
      tenantId: "tenant-a",
      threadId: response.threadId,
    });
    expect(thread?.userId).toBe("user-a");
  });

  test("stores the user turn and the assistant turn, in that order", async () => {
    const setup = await makeGateway();
    const response = await ask(setup, "hello");
    const turns = await loadTurns(setup, response.threadId);
    expect(turns.map(turn => turn.role)).toEqual([ETurnRole.USER, ETurnRole.ASSISTANT]);
  });

  test("continues the given thread: the next call sends the earlier turns", async () => {
    const setup = await makeGateway();
    const first = await ask(setup, "first");
    await ask(setup, "second", {threadId: first.threadId});
    const messages = setup.llmClient.completeCalls[1].request.messages;
    expect(messages.map(message => message.role)).toEqual([EMessageRole.USER, EMessageRole.ASSISTANT, EMessageRole.USER]);
  });

  test("sends a system prompt with the profile addendum", async () => {
    const setup = await makeGateway();
    await ask(setup, "hello");
    expect(joinSystem({blocks: setup.llmClient.completeCalls[0].request.system})).toContain("Always mention the invoice number.");
  });

  test("sends a system prompt with today's date", async () => {
    const setup = await makeGateway();
    await ask(setup, "hello");
    expect(joinSystem({blocks: setup.llmClient.completeCalls[0].request.system})).toContain("Today is Thursday, 2026-10-01.");
  });

  test("uses the profile named by profileId: \"default\" runs on model-a", async () => {
    const setup = await makeGateway();
    await ask(setup, "hello");
    expect(setup.llmClient.completeCalls[0].request.modelId).toBe("model-a");
  });

  test("uses the profile named by profileId", async () => {
    const setup = await makeGateway();
    await ask(setup, "hello", {profileId: "other"});
    expect(setup.llmClient.completeCalls[0].request.modelId).toBe("model-b");
  });

  test("tells the LLMClient who is calling: tenant, user, thread, kind CHAT", async () => {
    const setup = await makeGateway();
    const response = await ask(setup, "hello");
    expect(setup.llmClient.completeCalls[0].meta).toEqual({
      tenantId: "tenant-a",
      userId: "user-a",
      profileId: "default",
      threadId: response.threadId,
      kind: ETraceKind.CHAT,
    });
  });

  test("sends the sanitised prompt as the user message", async () => {
    const setup = await makeGateway();
    await ask(setup, "  hello  ");
    expect(setup.llmClient.completeCalls[0].request.messages[0].parts).toEqual([expect.objectContaining({text: "hello"})]);
  });

  test("throws the profile store's 404 when the tenant has no profile of that id", async () => {
    const {gateway} = await makeGateway();
    await expect(gateway.ask({
      profileId: "default",
      userContext: {
        ...userContext,
        tenantId: "tenant-without-profiles",
      },
      prompt: "hello",
      kbFilters: noKb,
    }).response).rejects.toMatchObject({
      code: 5372567786127,
      status: 404,
    });
  });

  test("throws the thread store's 404 for an unknown threadId", async () => {
    const {gateway} = await makeGateway();
    await expect(gateway.ask({
      profileId: "default",
      userContext,
      prompt: "hello",
      kbFilters: noKb,
      threadId: "missing",
    }).response).rejects.toMatchObject({
      code: 5372567786151,
      status: 404,
    });
  });
});
