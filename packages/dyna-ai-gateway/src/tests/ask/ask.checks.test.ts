import {z} from "zod";

import {
  IIssue,
  TGatewayResponse,
  EFinishReason,
  EGatewayResponseKind,
  EIssueSeverity,
} from "../..";

import {
  IGatewaySetup,
  makeGateway,
  makeModelResult,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {sumMatchesTotal} from "../internal/utils/sumMatchesTotal";

const invoiceSchema = z.object({
  total: z.number(),
  lines: z.array(z.object({amount: z.number()})),
});

const askInvoice = (
  {
    gateway,
    llmClient,
  }: IGatewaySetup,
  structured: unknown,
): Promise<TGatewayResponse<z.infer<typeof invoiceSchema>>> => {
  llmClient.enqueueComplete(makeModelResult({
    text: JSON.stringify(structured),
    structured,
  }));
  return gateway.ask({
    profileId: "default",
    userContext,
    prompt: "read the invoice",
    kbFilters: noKb,
    outputSchema: invoiceSchema,
  }).response;
};

const countTurns = async (setup: IGatewaySetup, threadId = ""): Promise<number> =>
  (await setup.config.threadStore.repository.loadTurns({
    tenantId: "tenant-a",
    threadId,
    desc: false,
    skip: 0,
    limit: 100,
  })).length;

const issueCodes = (response: TGatewayResponse): string[] =>
  response.kind === EGatewayResponseKind.PAUSED
    ? []
    : response.issues.map(issue => issue.code);

const softRule = {
  name: "soft",
  check: async (): Promise<IIssue[]> => [{
    code: "soft_warning",
    message: "Check this field",
    severity: EIssueSeverity.WARNING,
  }],
};

describe("AIGateway — M1: ask, the checks", () => {
  test("a rejected prompt returns FAILED with the guardrail issue", async () => {
    const {gateway} = await makeGateway();
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "   ",
      kbFilters: noKb,
    }).response;
    expect([response.kind, issueCodes(response)]).toEqual([EGatewayResponseKind.FAILED, ["prompt_empty"]]);
  });

  test("a rejected prompt does not reach the model", async () => {
    const {
      gateway,
      llmClient,
    } = await makeGateway();
    await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "   ",
      kbFilters: noKb,
    }).response;
    expect(llmClient.completeCalls).toEqual([]);
  });

  test("returns the validated structured output", async () => {
    const setup = await makeGateway();
    const invoice = {
      total: 30,
      lines: [{amount: 10}, {amount: 20}],
    };
    expect(await askInvoice(setup, invoice)).toMatchObject({
      kind: EGatewayResponseKind.ANSWER,
      structured: invoice,
    });
  });

  test("the structured answer is typed by the outputSchema", async () => {
    const setup = await makeGateway();
    const response = await askInvoice(setup, {
      total: 30,
      lines: [{amount: 30}],
    });
    // Compiles without a cast: `structured` is {total: number; lines: {amount: number}[]}
    const firstAmount: number | undefined = response.kind === EGatewayResponseKind.ANSWER
      ? response.structured?.lines[0]?.amount
      : undefined;
    expect(firstAmount).toBe(30);
  });

  test("a structured output that does not match the schema returns FAILED with output_schema", async () => {
    const setup = await makeGateway();
    const response = await askInvoice(setup, {
      total: "thirty",
      lines: [],
    });
    expect([response.kind, issueCodes(response)]).toEqual([EGatewayResponseKind.FAILED, ["output_schema"]]);
  });

  test("an output rule WARNING is returned in the answer's issues", async () => {
    const setup = await makeGateway({guardrails: {outputRules: [softRule]}});
    const response = await askInvoice(setup, {
      total: 30,
      lines: [{amount: 30}],
    });
    expect([response.kind, issueCodes(response)]).toEqual([EGatewayResponseKind.ANSWER, ["soft_warning"]]);
  });

  test("an output rule ERROR returns FAILED with the rule's issue", async () => {
    const setup = await makeGateway({guardrails: {outputRules: [sumMatchesTotal]}});
    const response = await askInvoice(setup, {
      total: 31,
      lines: [{amount: 10}, {amount: 20}],
    });
    expect([response.kind, issueCodes(response)]).toEqual([EGatewayResponseKind.FAILED, ["sum_mismatch"]]);
  });

  test("a failed answer is not stored: the thread holds the user turn only", async () => {
    const setup = await makeGateway({guardrails: {outputRules: [sumMatchesTotal]}});
    const response = await askInvoice(setup, {
      total: 31,
      lines: [{amount: 10}, {amount: 20}],
    });
    expect(await countTurns(setup, response.threadId)).toBe(1);
  });

  test("a truncated answer is returned as an ANSWER with the WARNING output_truncated", async () => {
    const {
      gateway,
      llmClient,
    } = await makeGateway();
    llmClient.enqueueComplete(makeModelResult({finishReason: EFinishReason.LENGTH}));
    const response = await gateway.ask({
      profileId: "default",
      userContext,
      prompt: "hello",
      kbFilters: noKb,
    }).response;
    expect([response.kind, issueCodes(response)]).toEqual([EGatewayResponseKind.ANSWER, ["output_truncated"]]);
  });
});
