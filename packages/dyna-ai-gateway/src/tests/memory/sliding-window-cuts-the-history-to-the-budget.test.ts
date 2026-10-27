import {
  AIGateway,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {askOnThread} from "../internal/utils/askOnThread";

import {gatewayConfigSlidingWindow} from "./sliding-window.config";

/**
 * The window is sized by the model's context: on a 1 200-token model, two questions of ~500 tokens each do not fit next to the
 * system prompt and the answer reserve. The newest turns stay, the oldest go, the call reports it; the current question is always in.
 */
test("SLIDING_WINDOW: a long thread on a small-window model is cut to the budget, newest turns kept, with a WARNING turns_trimmed", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSlidingWindow, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const longPrompt = (index: number): string => `Question ${index}: ${"word ".repeat(500)}`;
  const first = await askOnThread({
    gateway,
    llmClient,
    profileId: "small-window",
    prompt: longPrompt(1),
  });
  await askOnThread({
    gateway,
    llmClient,
    profileId: "small-window",
    prompt: longPrompt(2),
    threadId: first.threadId,
  });
  const third = await askOnThread({
    gateway,
    llmClient,
    profileId: "small-window",
    prompt: "Question 3: short",
    threadId: first.threadId,
  });

  const seen = (third.debug?.messages ?? []).slice(0, -1);
  const texts = seen.map(message => message.parts.map(part => part.kind === EPartKind.TEXT ? part.text.slice(0, 10) : part.kind).join(""));
  expect([
    seen.length < 5,
    texts.at(-1),
    texts.includes("Question 1"),
    third.issues.map(issue => issue.code),
  ]).toEqual([true, "Question 3", false, ["turns_trimmed"]]);
});
