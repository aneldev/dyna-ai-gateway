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
 * updateMemory -- the memory work after an answer: the thread's working memory, then the user's facts
 *
 * # About
 *
 * > Step 11, in the background: nobody waits for it.
 *
 * Hands the answered call to the thread's working memory (`WorkingMemory.saveContext`, which decides itself whether its
 * strategy has anything to update, D122), then extracts user facts when they are due (`UserMemoryStore.isExtractDue`: the
 * turns since the last multiple of `extractEveryTurns`). The cheap model is the profile's, or the config's default.
 * A helper call the usage adapter refuses is skipped by the memory classes themselves.
 *
 * Queued by `scheduleMemory` after an ANSWER only (not FAILED, not PAUSED), in the thread's background line; a failure
 * is logged by the queue, never thrown to the caller.
 *
 * # Who needs it
 *
 * `AIGateway.scheduleMemory`.
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
