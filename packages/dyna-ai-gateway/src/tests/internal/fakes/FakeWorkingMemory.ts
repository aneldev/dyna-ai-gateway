import {
  IAIProfile,
  IIssue,
  IMessage,
  IModelInfo,
  IWorkingMemory,
  IWorkingMemoryLoad,
  IWorkingMemoryState,
} from "../../..";

/** One `load` call of the fake, as the assembler made it. */
export interface IFakeWorkingMemoryLoadCall {
  tenantId: string;
  threadId: string;
  profile: IAIProfile;
  model: IModelInfo;
  budgetTokens: number;
}

/**
 * IWorkingMemory with a scripted window: `load` returns the messages, notes and issues it was given, whatever the thread.
 * For the unit tests of the ContextAssembler, which test what the assembler does with a window, not how the memory builds it.
 * `saveContext` records its calls; `getState` is the empty state; `reset` does nothing.
 */
export class FakeWorkingMemory implements IWorkingMemory {
  public readonly loadCalls: IFakeWorkingMemoryLoadCall[] = [];
  public readonly saveContextCalls: Parameters<IWorkingMemory["saveContext"]>[0][] = [];

  constructor(
    private readonly window: {
      messages?: IMessage[];
      notes?: string;
      issues?: IIssue[];
    } = {},
  ) {}

  public async load(args: IFakeWorkingMemoryLoadCall): Promise<IWorkingMemoryLoad> {
    this.loadCalls.push(args);
    return {
      messages: this.window.messages ?? [],
      notes: this.window.notes ?? "",
      issues: this.window.issues ?? [],
    };
  }

  public async saveContext(args: Parameters<IWorkingMemory["saveContext"]>[0]): Promise<void> {
    this.saveContextCalls.push(args);
  }

  public async getState(): Promise<IWorkingMemoryState> {
    return {
      summary: "",
      facts: {},
      updatedAtTurn: 0,
    };
  }

  public async reset(): Promise<void> {
    // Nothing is stored
  }
}
