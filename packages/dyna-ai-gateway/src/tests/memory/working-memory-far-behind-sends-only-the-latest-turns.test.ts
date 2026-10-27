import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  ETraceKind,
  ETurnRole,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigWorkingMemoryBehind} from "./working-memory-behind.config";

/**
 * After failed updates the thread memory falls behind, and the next update sent every turn since: a batch that grows with
 * the thread until it overflows the cheap model. It now sends the latest 20 turns, and the memory counts as updated up to now.
 */
test("a thread memory 50 turns behind is updated from the latest 20 turns and then counts as up to date", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigWorkingMemoryBehind, {llmClient: () => llmClient});
  const {repository} = gatewayConfigWorkingMemoryBehind.threadStore;
  const {tenantId} = sampleUserContext;
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "First.",
  }));
  llmClient.enqueueComplete(makeModelResult({
    structured: {
      summary: "Started.",
      facts: [],
    },
  }), ETraceKind.MEMORY_WORKING);
  const first = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  await gateway.whenIdle();
  if (first.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5377210486177,
      message: `Test setup: expected ANSWER, got ${first.kind}`,
      data: {first},
    });
  }
  // 50 turns the memory never saw, as after a row of failed updates
  for (let index = 0; index < 50; index++) {
    await repository.appendTurn({
      tenantId,
      threadId: first.threadId,
      turn: {
        id: `old-${index}`,
        role: index % 2 ? ETurnRole.ASSISTANT : ETurnRole.USER,
        parts: [{
          kind: EPartKind.TEXT,
          text: `Message ${index}`,
        }],
        createdAt: new Date(),
      },
    });
  }
  const stored = await repository.loadThread({
    tenantId,
    threadId: first.threadId,
  });
  if (!stored) {
    throw dynaError({
      code: 5377210486179,
      message: "Test setup: the thread is not stored",
      data: {threadId: first.threadId},
    });
  }
  await repository.saveThread({
    thread: {
      ...stored,
      turnCount: stored.turnCount + 50,
    },
  });

  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Second.",
  }));
  llmClient.enqueueComplete(makeModelResult({
    structured: {
      summary: "Caught up.",
      facts: [],
    },
  }), ETraceKind.MEMORY_WORKING);
  await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    threadId: first.threadId,
    prompt: "And now?",
    kbFilters: noKb,
  }).response;
  await gateway.whenIdle();

  const memoryCall = llmClient.completeCalls.filter(call => call.meta.kind === ETraceKind.MEMORY_WORKING).at(-1);
  const transcript = memoryCall?.request.messages[0].parts[0];
  const sentLines = transcript?.kind === EPartKind.TEXT ? transcript.text.split("\n").filter(line => line.trim()) : [];
  const thread = await repository.loadThread({
    tenantId,
    threadId: first.threadId,
  });
  expect([sentLines.length, sentLines.some(line => line.includes("Message 29")), thread?.workingMemory.updatedAtTurn]).toEqual([
    20,
    false,
    thread?.turnCount,
  ]);
});
