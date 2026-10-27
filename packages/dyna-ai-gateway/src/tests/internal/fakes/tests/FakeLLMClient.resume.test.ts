import {
  DEFAULT_TOOL_REJECTION_TEXT,
  EMessageRole,
  EPartKind,
  EResumeAction,
  ERunOutcomeStatus,
} from "../../../..";

import {FakeLLMClient} from "../FakeLLMClient";

import {
  makeCall,
  makeProbe,
  pauseAndResume,
  run,
} from "./utils/runFixtures";

const makePausedLLMClient = (): FakeLLMClient => {
  const llmClient = new FakeLLMClient();
  llmClient.enqueueRunStep({toolCall: makeCall("refund")});
  llmClient.enqueueRunStep({text: "refunded"});
  return llmClient;
};

describe("FakeLLMClient — run with resume", () => {
  test("APPROVE executes the pending tool", async () => {
    const probe = makeProbe(["refund"]);
    await pauseAndResume(makePausedLLMClient(), probe, {action: EResumeAction.APPROVE});
    expect(probe.executed).toEqual([makeCall("refund")]);
  });

  test("APPROVE continues the script to DONE", async () => {
    const outcome = await pauseAndResume(makePausedLLMClient(), makeProbe(["refund"]), {action: EResumeAction.APPROVE});
    expect([outcome.status, outcome.result?.text]).toEqual([ERunOutcomeStatus.DONE, "refunded"]);
  });

  test("EDIT executes the pending tool with the edited input", async () => {
    const probe = makeProbe(["refund"]);
    await pauseAndResume(makePausedLLMClient(), probe, {
      action: EResumeAction.EDIT,
      editedInput: {invoiceId: "9999"},
    });
    expect(probe.executed).toEqual([makeCall("refund", {invoiceId: "9999"})]);
  });

  test("REJECT does not execute the pending tool", async () => {
    const probe = makeProbe(["refund"]);
    await pauseAndResume(makePausedLLMClient(), probe, {
      action: EResumeAction.REJECT,
      text: "too expensive",
    });
    expect(probe.executed).toEqual([]);
  });

  test("REJECT adds a tool result with rejected: true and the composed rejection text", async () => {
    const outcome = await pauseAndResume(makePausedLLMClient(), makeProbe(["refund"]), {
      action: EResumeAction.REJECT,
      text: "too expensive",
    });
    const toolMessage = outcome.messages.find(message => message.role === EMessageRole.TOOL);
    expect(toolMessage?.parts[0]).toMatchObject({
      output: `${DEFAULT_TOOL_REJECTION_TEXT} Reason: too expensive`,
      rejected: true,
    });
  });

  test("ANSWER stores the answers as the result of the pending tool call (D62)", async () => {
    const answers = [{
      question: "Which invoice?",
      selected: ["4521"],
    }];
    const outcome = await pauseAndResume(makePausedLLMClient(), makeProbe(["refund"]), {
      action: EResumeAction.ANSWER,
      answers,
    });
    const toolMessage = outcome.messages.find(message => message.role === EMessageRole.TOOL);
    expect(toolMessage?.parts[0]).toMatchObject({
      kind: EPartKind.TOOL_RESULT,
      output: {answers},
    });
  });

  test("a resume without a pending tool call throws", async () => {
    const llmClient = new FakeLLMClient();
    await expect(run(llmClient, makeProbe(), {
      messages: [],
      decisions: [{action: EResumeAction.APPROVE}],
    })).rejects.toThrow("needs a pending tool call");
  });
});
