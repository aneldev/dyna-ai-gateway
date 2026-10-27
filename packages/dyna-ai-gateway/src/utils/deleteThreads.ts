import {
  IFileRef,
  EPartKind,
} from "../contracts";
import {IThread} from "../internal";
import {
  IBackgroundTasks,
  makeOwnerKey,
} from "../orchestration/createBackgroundTasks";
import {
  IAIGatewayDeps,
  IDeleteArgs,
  IDeleteResult,
} from "../types";

/**
 * deleteThreads -- removes threads with everything they left in the stores
 *
 * # About
 *
 * > One pass, every store: thread, turns, working memory, files, runs, trace entries.
 *
 * Resolves the ids (`"all"` lists the tenant's or the user's threads), keeps only the threads that exist in the tenant,
 * belong to the user when one is named and are not busy (a live lease is a call in flight: that thread is skipped), waits
 * for the background memory updates of the owners so nothing is written after the delete, removes the files the turns
 * point at, then calls the bulk `delete` of the thread, run and trace stores. Hard delete, no tombstone.
 *
 * # Who needs it
 *
 * `AIGateway.delete`.
 *
 * # Pitfalls
 *
 * Only the thread owner's files are removed: a pointer stored before the gateway checked the uploader may name another
 * user's file, which stays. A skipped thread is not counted; the next call finds it again once its call ended.
 */
export const deleteThreads = async (
  {
    deps,
    background,
    tenantId,
    threadIds,
    userId,
  }: IDeleteArgs & {
    deps: IAIGatewayDeps;
    background: IBackgroundTasks;
  },
): Promise<IDeleteResult> => {
  const ids = threadIds === "all"
    ? await deps.threadStore.listThreadIds({
      tenantId,
      userId,
    })
    : [...new Set(threadIds)];
  const now = new Date();
  const threads: IThread[] = [];
  for (const threadId of ids) {
    const thread = await deps.threadStore.findThread({
      tenantId,
      threadId,
    });
    if (!thread || (userId !== undefined && thread.userId !== userId)) continue;
    if (thread.lease && thread.lease.expiresAt.getTime() > now.getTime()) continue;
    threads.push(thread);
  }
  if (!threads.length) return {threads: 0};

  for (const owner of new Set(threads.map(thread => makeOwnerKey(tenantId, thread.userId)))) await background.whenIdle(owner);
  for (const thread of threads) await removeFiles(deps, thread);

  const chosen = threads.map(thread => thread.id);
  const counts = await deps.threadStore.delete({
    tenantId,
    threadIds: chosen,
  });
  await deps.runStore.delete({
    tenantId,
    threadIds: chosen,
  });
  await deps.trace.delete({
    tenantId,
    threadIds: chosen,
  });
  return {threads: counts.threads};
};

/** Removes the owner's files the thread's turns point at; the turns go with the thread right after. */
const removeFiles = async (deps: IAIGatewayDeps, thread: IThread): Promise<void> => {
  if (!thread.turnCount) return;
  const turns = await deps.threadStore.getLastTurns({
    tenantId: thread.tenantId,
    threadId: thread.id,
    limit: thread.turnCount,
  });
  const files = new Map<string, IFileRef>();
  turns.forEach(turn => turn.parts.forEach(part => {
    if (part.kind === EPartKind.FILE && part.file.tenantId === thread.tenantId && part.file.userId === thread.userId) files.set(part.file.id, part.file);
  }));
  for (const file of files.values()) {
    await deps.fileStore.remove({
      tenantId: thread.tenantId,
      userId: file.userId,
      fileId: file.id,
    });
  }
};
