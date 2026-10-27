import {dynaError} from "dyna-error";

import {IUserContext} from "../contracts";
import {IThread} from "../internal";
import {IAIGatewayDeps} from "../types";

/** Loads a thread of the calling user (D32): another user's thread is a 404, like a thread that does not exist. */
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
