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
 * "Forget this user" (GDPR): goes through every place the gateway holds something about a person, in the same tenant only.
 * Files and remembered facts are deleted in both modes, like the content of threads and runs: pseudonymising the id while
 * keeping the prompts is not erasure. Waits for the user's background work first, so that a queued memory update cannot bring
 * a fact back after the wipe; the caller keeps the user's calls out while it runs (`IUserCalls.whileErasing`).
 * A thread of the user with a live lease is a call in flight on another instance (this one's are awaited): the erasure is
 * refused whole with a 409 that names the busy threads, before anything is written -- a partial erasure would leave the
 * user's rows under two pseudonyms once retried. The caller retries when the lease has ended.
 * A second call finds nothing: the kept rows carry the pseudonym, not the user id.
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

/** 409 when a thread of the user holds a live lease: a call runs on another instance and would write after the erasure. */
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
