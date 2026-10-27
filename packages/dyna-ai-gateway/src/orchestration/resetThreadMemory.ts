import {IUserContext} from "../contracts";
import {IAIGatewayDeps} from "../types";

import {
  IBackgroundTasks,
  makeOwnerKey,
} from "./createBackgroundTasks";
import {getOwnThread} from "./getOwnThread";

/**
 * Clears the working memory of a thread of the calling user ("forget this thread").
 * Waits in the thread's background line: a memory update that is already queued runs first, so it cannot bring back
 * what was forgotten. Resolves when the memory is cleared; rejects with the error of the reset.
 */
export const resetThreadMemory = async (
  {
    deps,
    background,
    userContext,
    threadId,
  }: {
    deps: IAIGatewayDeps;
    background: IBackgroundTasks;
    userContext: IUserContext;
    threadId: string;
  },
): Promise<void> => {
  await getOwnThread({
    deps,
    userContext,
    threadId,
  });
  await new Promise<void>((resolve, reject) => background.run(threadId, () =>
    deps.workingMemory
      .reset({
        tenantId: userContext.tenantId,
        threadId,
      })
      .then(resolve, reject), makeOwnerKey(userContext.tenantId, userContext.userId)));
};
