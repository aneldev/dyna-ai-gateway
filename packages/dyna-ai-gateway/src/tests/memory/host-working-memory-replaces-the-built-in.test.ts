import {
  IWorkingMemory,
  IWorkingMemoryLoad,
  IWorkingMemoryState,
  AIGateway,
  EMessageRole,
  EPartKind,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {askOnThread} from "../internal/utils/askOnThread";

import {gatewayConfigHostWorkingMemory} from "./host-working-memory.config";

/** A host memory: the window is one fixed user message, the notes a fixed line; it records what the gateway hands it. */
class EchoMemory implements IWorkingMemory {
  public readonly loads: Array<{threadId: string; budgetTokens: number}> = [];
  public readonly saves: Array<{threadId: string; resultText?: string}> = [];

  public async load(args: {threadId: string; budgetTokens: number}): Promise<IWorkingMemoryLoad> {
    this.loads.push(args);
    return {
      messages: [{
        role: EMessageRole.USER,
        parts: [{
          kind: EPartKind.TEXT,
          text: "Echo window",
        }],
      }],
      notes: "About this conversation so far:\nEcho notes",
      issues: [],
    };
  }

  public async saveContext(args: Parameters<IWorkingMemory["saveContext"]>[0]): Promise<void> {
    this.saves.push({
      threadId: args.threadId,
      resultText: args.result?.text,
    });
  }

  public async getState(): Promise<IWorkingMemoryState> {
    return {
      summary: "Echo",
      facts: {},
      updatedAtTurn: 0,
    };
  }

  public async reset(): Promise<void> {
    // Nothing stored
  }
}

/**
 * `overrides.workingMemory` replaces the built-in memory: the assembler takes the host's window and notes, the background update
 * hands the host the answer, the facade reads the host's state.
 */
test("a host IWorkingMemory in overrides is asked for the window and handed the answer", async () => {
  const llmClient = new FakeLLMClient();
  const echo = new EchoMemory();
  const gateway = new AIGateway(gatewayConfigHostWorkingMemory, {
    llmClient: () => llmClient,
    workingMemory: () => echo,
  });
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const response = await askOnThread({
    gateway,
    llmClient,
    prompt: "Hello",
    answer: "Hi there",
  });

  const seen = (response.debug?.messages ?? []).slice(0, -1);
  expect([
    seen.map(message => message.parts.map(part => part.kind === EPartKind.TEXT ? part.text : part.kind).join("")),
    response.debug?.system.includes("Echo notes"),
    echo.loads.map(load => [load.threadId === response.threadId, load.budgetTokens > 0]),
    echo.saves,
  ]).toEqual([
    ["Echo window"],
    true,
    [[true, true]],
    [{
      threadId: response.threadId,
      resultText: "Hi there",
    }],
  ]);
});
