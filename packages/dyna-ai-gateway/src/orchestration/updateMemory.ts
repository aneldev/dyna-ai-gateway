import {IUserContext} from "../contracts";
import {
  IAIProfile,
  IModelRequest,
  IModelResult,
  ETraceKind,
} from "../internal";
import {
  IAIGatewayConfig,
  IAIGatewayDeps,
} from "../types";

/** Turns between two extractions of user facts when the UserMemoryStore config names none (its own default). */
const DEFAULT_EXTRACT_EVERY_TURNS = 10;

/**
 * Step 11, after an answer: hands the answered call to the thread's working memory (`saveContext`, which decides itself
 * whether its strategy has anything to update) and extracts user facts when they are due.
 * Runs in the background. A helper call the usage adapter refuses is skipped by the memory classes themselves.
 */
export const updateMemory = async (
  {
    deps,
    config,
    userContext,
    threadId,
    profile,
    previousTurnCount,
    request,
    result,
  }: {
    deps: IAIGatewayDeps;
    config: IAIGatewayConfig;
    userContext: IUserContext;
    threadId: string;
    profile: IAIProfile;
    /** Turns of the thread before the call that just ended. */
    previousTurnCount: number;
    /** The request the answer was produced for, when the gateway has it. */
    request?: IModelRequest;
    /** The model's answer; absent when a human wrote or edited it (a reviewed run). */
    result?: IModelResult;
  },
): Promise<void> => {
  const {
    tenantId,
    userId,
  } = userContext;
  const cheapModelId = profile.cheapModelId ?? config.defaultCheapModelId;

  await deps.workingMemory.saveContext({
    tenantId,
    userId,
    threadId,
    profile,
    request,
    result,
    cheapModelId,
    meta: {
      tenantId,
      userId,
      profileId: profile.id,
      threadId,
      kind: ETraceKind.MEMORY_WORKING,
    },
  });

  const {turnCount} = await deps.threadStore.getThread({
    tenantId,
    threadId,
  });
  if (deps.userMemoryStore.isExtractDue({
    turnCount,
    previousTurnCount,
  })) {
    // The turns since the multiple of extractEveryTurns that the previous extraction crossed
    const every = config.userMemoryStore.extractEveryTurns ?? DEFAULT_EXTRACT_EVERY_TURNS;
    await deps.userMemoryStore.extract({
      tenantId,
      userId,
      threadId,
      turns: await deps.threadStore.getLastTurns({
        tenantId,
        threadId,
        limit: turnCount - Math.floor(previousTurnCount / every) * every,
      }),
      cheapModelId,
      meta: {
        tenantId,
        userId,
        profileId: profile.id,
        threadId,
        kind: ETraceKind.MEMORY_USER,
      },
    });
  }
};
