import {z} from "zod";
import {dynaError} from "dyna-error";

import {
  IPausedResponse,
  IToolCallPart,
  IToolDef,
  IUserContext,
  TGatewayResponse,
  EGatewayResponseKind,
  EPartKind,
  EPauseKind,
  EResumeAction,
  defineTool,
  EToolCallVerdict,
  TToolCallPolicyResult,
} from "../..";

import {
  IGatewaySetup,
  makeGateway,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";

//#region "types"

/**
 * The Human Gate by example: a `refund` tool pauses for a human only when the amount is 100 or more (IToolDef.policy, D87).
 * Below that it runs like any other tool. A pause comes back as a PAUSED response; the human's decision goes in through `resume`.
 */

interface IRefund {
  amount: number;
  userId: string;
}

interface IRefundInput {
  amount: number;
}

interface IRefundOutput {
  refunded: number;
}

/** The app's refund tool, as a fake: records every refund it performs. Pauses for a human from 100 on. */
interface IRefundTool {
  tool: IToolDef<IRefundInput, IRefundOutput>;
  refunds: IRefund[];
}

const supervisor: IUserContext = {
  ...userContext,
  userId: "supervisor-a",
};

//#endregion "types"

//#region "Make gateway and tool"

/**
 * Create the tool, but also provide the refunds to evaluate the results.
 */
const makeRefundTool = (): IRefundTool => {
  const refunds: IRefund[] = [];
  const tool = defineTool({
    name: "refund",
    description: "Refunds an amount to the customer.",
    inputSchema: z.object({amount: z.number()}),
    tags: ["billing"],
    policy: ({input}): TToolCallPolicyResult => ({verdict: input.amount >= 100 ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW}),
    execute: async ({
      input: {amount},
      userContext: {userId},
    }): Promise<IRefundOutput> => {
      refunds.push({
        amount,
        userId,
      });
      return {refunded: amount};
    },
  });
  return {
    tool,
    refunds,
  };
};

/** A gateway whose profile `default` may use the given tool; the tool's own rule decides the approval. */
const makeHumanGateGateway = (tool: IToolDef): Promise<IGatewaySetup> =>
  makeGateway({toolRegistry: {tools: [tool]}}, [tool.name]);

//#endregion "Make gateway and tool"

//#region "Ask some with Gateway and the tool"

const refundCall = (amount: number): IToolCallPart => ({
  kind: EPartKind.TOOL_CALL,
  callId: "call-refund",
  toolName: "refund",
  input: {amount},
});

/** The model asks for a refund of `amount`, then answers "Refunded." */
const askForRefund = (setup: IGatewaySetup, amount: number): Promise<TGatewayResponse> => {
  setup.llmClient.enqueueRunStep({toolCall: refundCall(amount)});
  setup.llmClient.enqueueRunStep({text: "Refunded."});
  return setup.gateway.run({
    profileId: "default",
    userContext,
    prompt: `refund ${amount} to the customer`,
    kbFilters: noKb,
  }).response;
};

/** A big refund, paused and waiting for the human. */
const askForBigRefund = async (setup: IGatewaySetup): Promise<IPausedResponse> => {
  const response = await askForRefund(setup, 500);
  if (response.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5374037241356,
      message: `Test setup: expected PAUSED, got ${response.kind}`,
      data: {response},
    });
  }
  return response;
};

//#endregion "Ask some with Gateway and the tool"

describe("AIGateway — Human Gate by example", () => {
  test("a small refund runs without a human", async () => {
    const {
      tool,
      refunds,
    } = makeRefundTool();
    const setup = await makeHumanGateGateway(tool);
    const response = await askForRefund(setup, 20);
    expect(response).toMatchObject({
      kind: EGatewayResponseKind.ANSWER,
      text: "Refunded.",
    });
    expect(refunds).toEqual([{
      amount: 20,
      userId: "user-a",
    }]);
  });

  test("a big refund pauses: nothing is executed and the envelope describes the pending call", async () => {
    const {
      tool,
      refunds,
    } = makeRefundTool();
    const setup = await makeHumanGateGateway(tool);
    const response = await askForRefund(setup, 500);
    expect(response).toMatchObject({
      kind: EGatewayResponseKind.PAUSED,
      envelopes: [{
        kind: EPauseKind.TOOL_APPROVAL,
        toolCall: refundCall(500),
        allowed: [
          EResumeAction.APPROVE,
          EResumeAction.EDIT,
          EResumeAction.REJECT,
        ],
      }],
    });
    expect(refunds).toEqual([]);
  });

  test("APPROVE: the tool runs as the approver and the run finishes with the answer", async () => {
    const {
      tool,
      refunds,
    } = makeRefundTool();
    const setup = await makeHumanGateGateway(tool);
    const paused = await askForBigRefund(setup);

    const response = await setup.gateway.resume({
      userContext: supervisor,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;

    expect(response).toMatchObject({
      kind: EGatewayResponseKind.ANSWER,
      text: "Refunded.",
    });
    expect(refunds).toEqual([{
      amount: 500,
      userId: "supervisor-a",
    }]);
  });

  test("EDIT: the tool runs with the approver's input", async () => {
    const {
      tool,
      refunds,
    } = makeRefundTool();
    const setup = await makeHumanGateGateway(tool);
    const paused = await askForBigRefund(setup);

    await setup.gateway.resume({
      userContext: supervisor,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.EDIT,
        editedInput: {amount: 250},
      }],
    }).response;

    expect(refunds).toEqual([{
      amount: 250,
      userId: "supervisor-a",
    }]);
  });

  test("REJECT: nothing runs; the model gets the reason and still answers", async () => {
    const {
      tool,
      refunds,
    } = makeRefundTool();
    const setup = await makeHumanGateGateway(tool);
    const paused = await askForBigRefund(setup);

    const response = await setup.gateway.resume({
      userContext: supervisor,
      runId: paused.envelopes[0].runId,
      pauseId: paused.envelopes[0].pauseId,
      decisions: [{
        action: EResumeAction.REJECT,
        text: "Above the daily limit",
      }],
    }).response;

    expect(response.kind).toBe(EGatewayResponseKind.ANSWER);
    expect(refunds).toEqual([]);
  });
});
