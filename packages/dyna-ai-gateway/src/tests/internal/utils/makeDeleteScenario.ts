import {dynaError} from "dyna-error";
import {randomUUID} from "node:crypto";

import {
  IAIGatewayConfig,
  IUserContext,
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  ETraceKind,
} from "../../..";

import {FakeLLMClient} from "../fakes/FakeLLMClient";
import {openAiModel} from "../samples/models";
import {sendEmailTool} from "../samples/tools";

import {
  makeModelResult,
  noKb,
} from "./makeGateway";
import {sampleUserContext} from "./sampleUserContext";

/** A second user of the same tenant. */
export const otherUserContext: IUserContext = {
  ...sampleUserContext,
  userId: "user-b",
};

/** What one call leaves behind: the thread, and the run when the call paused. */
export interface IDeleteScenarioThread {
  threadId: string;
  runId: string | null;
}

/**
 * The stores of the delete tests, all filled: an answered ask (a user turn, an assistant turn, a CHAT trace entry, a memory
 * job) and a run paused on `send_email` (a stored run), per user. Returns the thread ids by user, in that order.
 */
export const makeDeleteScenario = async (
  {
    gateway,
    llmClient,
  }: {
    gateway: AIGateway;
    llmClient: FakeLLMClient;
  },
): Promise<Record<"user" | "other", IDeleteScenarioThread[]>> => {
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const result: Record<"user" | "other", IDeleteScenarioThread[]> = {
    user: [],
    other: [],
  };
  for (const [who, userContext] of [["user", sampleUserContext], ["other", otherUserContext]] as const) {
    result[who].push(await askOnce({
      gateway,
      llmClient,
      userContext,
    }));
    result[who].push(await pauseOnce({
      gateway,
      llmClient,
      userContext,
    }));
  }
  await gateway.whenIdle();
  return result;
};

/** One answered ask of the user; its memory job finds nothing to remember. */
export const askOnce = async (
  {
    gateway,
    llmClient,
    userContext,
    threadId,
  }: {
    gateway: AIGateway;
    llmClient: FakeLLMClient;
    userContext: IUserContext;
    threadId?: string;
  },
): Promise<IDeleteScenarioThread> => {
  // One trace id per scripted result: the trace store keys its entries by it, so a shared id would overwrite the last thread's entry
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello.",
    traceId: randomUUID(),
  }));
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    structured: {facts: []},
    traceId: randomUUID(),
  }), ETraceKind.MEMORY_USER);
  const answer = await gateway.ask({
    profileId: "default",
    userContext,
    threadId,
    prompt: "Hello",
    kbFilters: noKb,
  }).response;
  if (answer.kind !== EGatewayResponseKind.ANSWER || !answer.threadId) {
    throw dynaError({
      code: 5377210486142,
      message: `Test setup: expected ANSWER on a thread, got ${answer.kind}`,
      data: {answer},
    });
  }
  return {
    threadId: answer.threadId,
    runId: null,
  };
};

/** One run of the user paused on the approval of `send_email`. */
export const pauseOnce = async (
  {
    gateway,
    llmClient,
    userContext,
  }: {
    gateway: AIGateway;
    llmClient: FakeLLMClient;
    userContext: IUserContext;
  },
): Promise<IDeleteScenarioThread> => {
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-1",
      toolName: sendEmailTool.name,
      input: {
        to: "bob@example.com",
        subject: "Hi",
        body: "Hello",
      },
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext,
    prompt: "Email Bob",
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5377210486153,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  return {
    threadId: paused.threadId,
    runId: paused.envelopes[0].runId,
  };
};

/** What the stores still hold of a thread: the thread, its turns, its run, its trace entries. */
export const loadRemains = async (
  config: IAIGatewayConfig,
  tenantId: string,
  {
    threadId,
    runId,
  }: IDeleteScenarioThread,
): Promise<{thread: boolean; turns: number; run: boolean; traces: number}> => ({
  thread: (await config.threadStore.repository.loadThread({
    tenantId,
    threadId,
  })) !== null,
  turns: (await config.threadStore.repository.loadTurns({
    tenantId,
    threadId,
    desc: false,
    skip: 0,
    limit: 100,
  })).length,
  run: runId !== null && (await config.runStore.repository.load({
    tenantId,
    runId,
  })) !== null,
  traces: (await config.trace.repository.query({
    tenantId,
    filters: {threadId},
    skip: 0,
    limit: 100,
  })).length,
});
