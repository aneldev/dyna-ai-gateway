import {
  ELLMClientEventKind,
  EMessageRole,
  ERunOutcomeStatus,
} from "../../../..";

import {FakeLLMClient} from "../FakeLLMClient";

import {
  makeCall,
  makeProbe,
  run,
} from "./utils/runFixtures";

describe("FakeLLMClient — run", () => {
  test("a text step ends the run DONE with that text", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueRunStep({text: "final answer"});
    const outcome = await run(llmClient, makeProbe());
    expect([outcome.status, outcome.result?.text]).toEqual([ERunOutcomeStatus.DONE, "final answer"]);
  });

  test("a tool step that needs no approval is executed through hooks.executeTool", async () => {
    const llmClient = new FakeLLMClient();
    const probe = makeProbe();
    llmClient.enqueueRunStep({toolCall: makeCall("getInvoice")});
    llmClient.enqueueRunStep({text: "done"});
    await run(llmClient, probe);
    expect(probe.executed).toEqual([makeCall("getInvoice")]);
  });

  test("the messages hold the tool call, its result and the final text, in order", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueRunStep({toolCall: makeCall("getInvoice")});
    llmClient.enqueueRunStep({text: "done"});
    const outcome = await run(llmClient, makeProbe());
    expect(outcome.messages.map(message => message.role)).toEqual([EMessageRole.ASSISTANT, EMessageRole.TOOL, EMessageRole.ASSISTANT]);
  });

  test("a tool step that needs approval pauses the run with that call pending", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    const outcome = await run(llmClient, makeProbe(["refund"]));
    expect([outcome.status, outcome.pendingCalls?.map(pending => pending.call)]).toEqual([ERunOutcomeStatus.PAUSED, [makeCall("refund")]]);
  });

  test("a paused run has not executed the pending tool", async () => {
    const llmClient = new FakeLLMClient();
    const probe = makeProbe(["refund"]);
    llmClient.enqueueRunStep({toolCall: makeCall("refund")});
    await run(llmClient, probe);
    expect(probe.executed).toEqual([]);
  });

  test("steps counts the model calls of this invocation", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueRunStep({toolCall: makeCall("getInvoice")});
    llmClient.enqueueRunStep({text: "done"});
    expect((await run(llmClient, makeProbe())).steps).toBe(2);
  });

  test("usage is the sum over the steps", async () => {
    const llmClient = new FakeLLMClient();
    llmClient.enqueueRunStep({
      toolCall: makeCall("getInvoice"),
      usage: {
        inputTokens: 10,
        outputTokens: 1,
      },
    });
    llmClient.enqueueRunStep({
      text: "done",
      usage: {
        inputTokens: 20,
        outputTokens: 2,
      },
    });
    expect((await run(llmClient, makeProbe())).usage).toEqual({
      inputTokens: 30,
      outputTokens: 3,
    });
  });

  test("events of a tool step and a text step arrive in order", async () => {
    const llmClient = new FakeLLMClient();
    const probe = makeProbe();
    llmClient.enqueueRunStep({toolCall: makeCall("getInvoice")});
    llmClient.enqueueRunStep({text: "done"});
    await run(llmClient, probe);
    expect(probe.events.map(event => event.kind)).toEqual([
      ELLMClientEventKind.TOOL_REQUEST,
      ELLMClientEventKind.TOOL_RESULT,
      ELLMClientEventKind.STEP_END,
      ELLMClientEventKind.TEXT_DELTA,
      ELLMClientEventKind.STEP_END,
      ELLMClientEventKind.DONE,
    ]);
  });

  test("run throws when the script has no step left", async () => {
    const llmClient = new FakeLLMClient();
    await expect(run(llmClient, makeProbe())).rejects.toThrow("none is enqueued");
  });

  test("enqueueRunStep throws when a step has both toolCall and toolCalls", () => {
    const llmClient = new FakeLLMClient();
    expect(() => llmClient.enqueueRunStep({
      toolCall: makeCall("refund"),
      toolCalls: [makeCall("refund")],
    })).toThrow("toolCall or toolCalls, not both");
  });

  test("enqueueRunStep throws when a step has neither a tool request nor text", () => {
    const llmClient = new FakeLLMClient();
    expect(() => llmClient.enqueueRunStep({})).toThrow("needs a tool request (toolCall, toolCalls) or text");
  });
});
