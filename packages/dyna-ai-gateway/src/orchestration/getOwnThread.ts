import {dynaError} from "dyna-error";

import {IUserContext} from "../contracts";
import {IThread} from "../internal";
import {IAIGatewayDeps} from "../types";

/**
 * getOwnThread -- loads a thread of the calling user (D32)
 *
 * # About
 *
 * > A thread of another user of the tenant is a 404, the same as a thread that does not exist.
 *
 * The ownership check of every call that names a `threadId`: nothing is screened, stored, leased or traced before it
 * passed. The 404 (`5372799784161`) tells the caller nothing about whether the thread exists.
 *
 * Runs before the thread's lease in `ask` and `run`; `prepareCall` reads the thread again under the lease, for its status.
 *
 * # Who needs it
 *
 * `AIGateway.ask`, `run`, `getTurns`, `renameThread`, `getThreadMemory`; `resetThreadMemory`.
 */
export const getOwnThread = async (
  {
    deps,
    userContext: {
      tenantId,
      userId,
    },
    threadId,
  }: {
    deps: IAIGatewayDeps;
    userContext: IUserContext;
    threadId: string;
  },
): Promise<IThread> => {
  const thread = await deps.threadStore.getThread({
    tenantId,
    threadId,
  });
  if (thread.userId !== userId) {
    throw dynaError({
      code: 5372799784161,
      status: 404,
      message: `AIGateway: unknown thread [${threadId}] for user [${userId}]`,
      data: {
        tenantId,
        threadId,
      },
    });
  }
  return thread;
};
