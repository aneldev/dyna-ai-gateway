import {
  AIGateway,
  ETraceKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {askOnThread} from "../internal/utils/askOnThread";
import {makeModelResult} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigSlidingWindow} from "./sliding-window.config";

/**
 * A thread written under SUMMARY_BUFFER keeps its summary when a SLIDING_WINDOW call follows: the window ignores it (no notes in
 * the prompt, no update) and does not wipe it, so a switch back to SUMMARY_BUFFER shows it again and resumes from it.
 */
test("a stored summary survives a SLIDING_WINDOW call unused and is used again after the switch back", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigSlidingWindow, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const scriptSummary = (summary: string): void => llmClient.enqueueComplete(makeModelResult({
    structured: {
      summary,
      facts: [],
    },
  }), ETraceKind.MEMORY_WORKING);
  const readMemory = (threadId: string): ReturnType<AIGateway["getThreadMemory"]> => gateway.getThreadMemory({
    userContext: sampleUserContext,
    threadId,
  });

  // 1. SUMMARY_BUFFER writes the summary
  scriptSummary("The user asks about invoice 4521.");
  const first = await askOnThread({
    gateway,
    llmClient,
    profileId: "summary",
    prompt: "Invoice 4521?",
  });
  // 2. SLIDING_WINDOW on the same thread: the summary is neither shown nor touched
  const sliding = await askOnThread({
    gateway,
    llmClient,
    prompt: "And the due date?",
    threadId: first.threadId,
  });
  const afterSliding = await readMemory(first.threadId);
  // 3. Back on SUMMARY_BUFFER: the summary is in the prompt, the update continues from it
  scriptSummary("The user asks about invoice 4521 and its due date.");
  const back = await askOnThread({
    gateway,
    llmClient,
    profileId: "summary",
    prompt: "Thanks",
    threadId: first.threadId,
  });
  const afterBack = await readMemory(first.threadId);

  expect([
    sliding.debug?.system.includes("invoice 4521"),
    afterSliding,
    back.debug?.system.includes("About this conversation so far:\nThe user asks about invoice 4521."),
    afterBack.summary,
    afterBack.updatedAtTurn,
  ]).toEqual([
    false,
    {
      summary: "The user asks about invoice 4521.",
      facts: {},
      updatedAtTurn: 2,
    },
    true,
    "The user asks about invoice 4521 and its due date.",
    6,
  ]);
});
