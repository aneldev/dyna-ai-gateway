import {
  AIGateway,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {askOnThread} from "../internal/utils/askOnThread";

import {gatewayConfigSlidingWindow} from "./sliding-window.config";

/** Under SLIDING_WINDOW the model reads the conversation itself: every earlier turn is in the request, word for word, no digest. */
test("SLIDING_WINDOW: the request carries the thread's turns verbatim, oldest first, and no memory notes", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSlidingWindow, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const first = await askOnThread({
    gateway,
    llmClient,
    prompt: "My invoice is 4521.",
    answer: "Noted: 4521.",
  });
  const second = await askOnThread({
    gateway,
    llmClient,
    prompt: "What did I say?",
    threadId: first.threadId,
  });

  // The debug messages end with the answer the model gave; before it, the messages it saw
  const seen = (second.debug?.messages ?? []).slice(0, -1);
  expect([
    seen.map(message => [message.role, message.parts.map(part => part.kind === EPartKind.TEXT ? part.text : part.kind).join("")]),
    second.debug?.system.includes("About this conversation"),
  ]).toEqual([
    [["USER", "My invoice is 4521."], ["ASSISTANT", "Noted: 4521."], ["USER", "What did I say?"]],
    false,
  ]);
});
