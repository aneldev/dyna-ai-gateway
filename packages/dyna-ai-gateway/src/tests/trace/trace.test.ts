import {z} from "zod";

import {
  ITraceEntry,
  EGatewayResponseKind,
  EPromptTemplateKey,
  EResumeAction,
  ETraceKind,
} from "../..";

import {
  IGatewaySetup,
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

const getEntries = ({gateway}: IGatewaySetup, threadId = ""): Promise<ITraceEntry[]> =>
  gateway.trace.query({
    tenantId: "tenant-a",
    filters: {threadId},
    skip: 0,
    limit: 100,
  });

describe("AIGateway — M3: trace", () => {
  test("ask leaves one CHAT entry with the template and the version the request was rendered from", async () => {
    const setup = await makeGateway();
    setup.llmClient.enqueueComplete(makeModelResult());
    const response = await setup.gateway.ask(input).response;
    expect(await getEntries(setup, response.threadId)).toMatchObject([
      {
        kind: ETraceKind.CHAT,
        templateKey: EPromptTemplateKey.CHAT_MAIN,
        templateVersion: 0,
        issues: [],
      },
    ]);
  });

  test("the issues of an answer that fails the checks are on its trace entry", async () => {
    const setup = await makeGateway();
    setup.llmClient.enqueueComplete(makeModelResult({text: "not what the schema asks for"}));
    const response = await setup.gateway.ask({
      ...input,
      outputSchema: z.object({total: z.number()}),
    }).response;
    const [entry] = await getEntries(setup, response.threadId);
    expect([response.kind, entry?.issues]).toEqual([
      EGatewayResponseKind.FAILED,
      response.kind === EGatewayResponseKind.FAILED ? response.issues : [],
    ]);
  });

  test("a run leaves one RUN_STEP entry per model call, each with the template version", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({toolCall: makeCall("get_invoice")});
    setup.llmClient.enqueueRunStep({text: "The total is 30."});
    const response = await setup.gateway.run(input).response;
    expect((await getEntries(setup, response.threadId)).map(entry => [entry.kind, entry.templateKey, entry.templateVersion])).toEqual([
      [ETraceKind.RUN_STEP, EPromptTemplateKey.CHAT_MAIN, 0],
      [ETraceKind.RUN_STEP, EPromptTemplateKey.CHAT_MAIN, 0],
    ]);
  });

  test("the entries of a resumed run carry the run id", async () => {
    const setup = await makeToolGateway();
    setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    const paused = await setup.gateway.run(input).response;
    const runId = paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "";
    const pauseId = paused.kind === EGatewayResponseKind.PAUSED ? paused.pauseId : "";
    setup.llmClient.enqueueRunStep({text: "Refunded."});
    await setup.gateway.resume({
      userContext,
      runId,
      pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;
    expect((await getEntries(setup, paused.threadId)).map(entry => entry.runId)).toEqual([undefined, runId]);
  });

  test("a trace that cannot be annotated does not fail the call", async () => {
    const setup = await makeGateway();
    jest.spyOn(setup.gateway.trace, "annotate").mockRejectedValue(new Error("the trace store is down"));
    const report = jest.spyOn(console, "error").mockImplementation(() => undefined);
    setup.llmClient.enqueueComplete(makeModelResult());
    const response = await setup.gateway.ask(input).response;
    report.mockRestore();
    expect(response.kind).toBe(EGatewayResponseKind.ANSWER);
  });
});
