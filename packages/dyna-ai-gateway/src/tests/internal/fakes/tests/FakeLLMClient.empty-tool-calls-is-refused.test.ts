import {FakeLLMClient} from "../FakeLLMClient";

/** An empty `toolCalls` is no tool request: without text the step would be a silent empty answer, so it is refused at enqueue time. */
test("enqueueRunStep refuses a step whose toolCalls is empty and that has no text", () => {
  const llmClient = new FakeLLMClient();
  expect(() => llmClient.enqueueRunStep({toolCalls: []})).toThrow("needs a tool request (toolCall, toolCalls) or text");
});
