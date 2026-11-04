import {randomUUID} from "node:crypto";
import {dynaError} from "dyna-error";

import {
  IAIGatewayDeps,
  IForgetUserResult,
} from "../types";

import {
  IBackgroundTasks,
  makeOwnerKey,
} from "./createBackgroundTasks";

/** What "forgotten" means for the rows that can stay. */
export enum EForgetUserMode {
  /** Every row of the user goes. */
  DELETE = "DELETE",
  /** Threads, runs and trace entries stay as skeletons under a pseudonym; their content and the user's files and facts go. */
  ANONYMIZE = "ANONYMIZE",
}

/** The pseudonym a kept row carries: `@anon-<uuid>`. Random, so there is no way back without the pseudonym the call returned. */
export const ANONYMIZED_USER_ID_PREFIX = "@anon-";

/**
 * forgetUser -- "forget this user" (GDPR), in one tenant
 *
 * # About
 *
 * > Every place the gateway holds something about a person, wiped or pseudonymised in one call.
 *
 * Goes through the stores in a fixed order: the user's files, the remembered facts, then the threads with their turns,
 * the runs and the trace entries. Files and facts are deleted in both modes, like the content of threads and runs:
 * pseudonymising the id while keeping the prompts is not erasure. DELETE removes the rows; ANONYMIZE keeps threads, runs
 * and trace entries as skeletons under a random pseudonym (`@anon-<uuid>`), returned once, with no way back without it.
 *
 * - Waits for the user's own background work first (`IBackgroundTasks.whenIdle(owner)`), so a queued memory update cannot
 *   bring a fact back after the wipe.
 * - A thread of the user with a live lease is a call in flight on another instance (this one's are awaited): the erasure is
 *   refused whole with a 409 that names the busy threads, before anything is written. A partial erasure retried would leave
 *   the user's rows under two pseudonyms.
 * - A second call finds nothing: the kept rows carry the pseudonym, not the user id.
 *
 * Runs inside `IUserCalls.whileErasing`: the caller keeps the user's calls out while it runs.
 *
 * # Who needs it
 *
 * `AIGateway.deleteUserData` (DELETE) and `AIGateway.anonymizeUserData` (ANONYMIZE).
 *
 * # Pitfalls
 *
 * One tenant only: the same person in another tenant is another erasure. The host's usage adapter keeps its own rows;
 * nothing here touches them.
 */
export const forgetUser = async (
  {
    deps,
    background,
    tenantId,
    userId,
    mode,
  }: {
    deps: IAIGatewayDeps;
    background: IBackgroundTasks;
    tenantId: string;
    userId: string;
    mode: EForgetUserMode;
  },
): Promise<IForgetUserResult> => {
  // The user's own queued memory updates only: a busy queue of another tenant must not hold the erasure up
  await background.whenIdle(makeOwnerKey(tenantId, userId));
  await refuseWhenBusy(deps, tenantId, userId);

  const files = await deps.fileStore.removeFilesByUser({
    tenantId,
    userId,
  });
  const userFacts = await deps.userMemoryStore.deleteByUser({
    tenantId,
    userId,
  });

  if (mode === EForgetUserMode.DELETE) {
    const {
      threads,
      turns,
    } = await deps.threadStore.delete({
      tenantId,
      threadIds: "all",
      userId,
    });
    return {
      files,
      userFacts,
      threads,
      turns,
      runs: await deps.runStore.delete({
        tenantId,
        threadIds: "all",
        userId,
      }),
      traces: await deps.trace.delete({
        tenantId,
        threadIds: "all",
        userId,
      }),
      pseudonym: null,
    };
  }

  const pseudonym = ANONYMIZED_USER_ID_PREFIX + randomUUID();
  const {
    threads,
    turns,
  } = await deps.threadStore.anonymizeByUser({
    tenantId,
    userId,
    pseudonym,
  });
  return {
    files,
    userFacts,
    threads,
    turns,
    runs: await deps.runStore.anonymizeByUser({
      tenantId,
      userId,
      pseudonym,
    }),
    traces: await deps.trace.anonymizeByUser({
      tenantId,
      userId,
      pseudonym,
    }),
    pseudonym,
  };
};

/**
 * 409 when a thread of the user holds a live lease.
 * A call runs on another instance and would write after the erasure.
 */
const refuseWhenBusy = async (deps: IAIGatewayDeps, tenantId: string, userId: string): Promise<void> => {
  const now = Date.now();
  const busyThreadIds: string[] = [];
  for (const threadId of await deps.threadStore.listThreadIds({
    tenantId,
    userId,
  })) {
    const thread = await deps.threadStore.findThread({
      tenantId,
      threadId,
    });
    if (thread?.lease && thread.lease.expiresAt.getTime() > now) busyThreadIds.push(threadId);
  }
  if (!busyThreadIds.length) return;
  throw dynaError({
    code: 5377210486241,
    status: 409,
    message: `AIGateway: the user [${userId}] of tenant [${tenantId}] has ${busyThreadIds.length} thread(s) with a call in flight; the erasure is refused, retry when they ended`,
    userMessage: "Your data cannot be deleted while a conversation is still running; please try again in a few minutes",
    data: {
      tenantId,
      userId,
      busyThreadIds,
    },
  });
};
