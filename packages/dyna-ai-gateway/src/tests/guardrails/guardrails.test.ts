import {
  IAIGatewayConfig,
  IInputEvidence,
  IOutputEvidence,
  EGatewayResponseKind,
  EIssueSeverity,
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

/** Rules that record the evidence they get; they always pass. */
const recordEvidence = (inputs: IInputEvidence[], outputs: IOutputEvidence[]): Partial<IAIGatewayConfig> => ({
  guardrails: {
    inputRules: [{
      name: "record_input",
      check: async ({evidence}) => {
        inputs.push(evidence);
        return [];
      },
    }],
    outputRules: [{
      name: "record_output",
      check: async ({evidence}) => {
        outputs.push(evidence);
        return [];
      },
    }],
  },
});

const input = {
  profileId: "default",
  userContext,
  prompt: "refund invoice 4521",
  kbFilters: noKb,
};

describe("AIGateway — the evidence of the Guardrails rules (D49)", () => {
  test("ask on a new thread: the input rules get the profile and no thread, the output rules the thread and the prompt", async () => {
    const inputs: IInputEvidence[] = [];
    const outputs: IOutputEvidence[] = [];
    const setup = await makeGateway(recordEvidence(inputs, outputs));
    setup.llmClient.enqueueComplete(makeModelResult());
    const response = await setup.gateway.ask(input).response;
    expect([
      inputs.map(evidence => [evidence.profile.id, evidence.threadId]),
      outputs.map(evidence => [evidence.profile.id, evidence.threadId, evidence.prompt]),
    ]).toEqual([
      [["default", undefined]],
      [["default", response.threadId, "refund invoice 4521"]],
    ]);
  });

  test("ask on an existing thread with another profile: the input rules get that thread and that profile", async () => {
    const inputs: IInputEvidence[] = [];
    const setup = await makeGateway(recordEvidence(inputs, []));
    setup.llmClient.enqueueComplete(makeModelResult());
    const first = await setup.gateway.ask(input).response;
    setup.llmClient.enqueueComplete(makeModelResult());
    await setup.gateway.ask({
      ...input,
      threadId: first.threadId,
      profileId: "other",
    }).response;
    expect(inputs.map(evidence => [evidence.profile.id, evidence.threadId])).toEqual([["default", undefined], ["other", first.threadId]]);
  });

  test("a resumed run: the output rules get the prompt the run started with", async () => {
    const outputs: IOutputEvidence[] = [];
    const setup = await makeToolGateway(recordEvidence([], outputs));
    setup.llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    const paused = await setup.gateway.run(input).response;
    setup.llmClient.enqueueRunStep({text: "Refunded."});
    await setup.gateway.resume({
      userContext,
      runId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].runId : "",
      pauseId: paused.kind === EGatewayResponseKind.PAUSED ? paused.envelopes[0].pauseId : "",
      decisions: [{action: EResumeAction.APPROVE}],
    }).response;
    expect(outputs.map(evidence => [evidence.profile.id, evidence.threadId, evidence.prompt, evidence.output]))
      .toEqual([["default", paused.threadId, "refund invoice 4521", "Refunded."]]);
  });

  test("the issues of the response name the rule that reported them", async () => {
    const setup = await makeGateway({
      guardrails: {
        outputRules: [{
          name: "length",
          check: async () => [{
            code: "long_answer",
            message: "Long answer",
            severity: EIssueSeverity.WARNING,
          }],
        }],
      },
    });
    setup.llmClient.enqueueComplete(makeModelResult());
    const response = await setup.gateway.ask(input).response;
    expect(response.kind === EGatewayResponseKind.ANSWER && response.issues.map(issue => [issue.code, issue.ruleName])).toEqual([["long_answer", "length"]]);
  });
});
