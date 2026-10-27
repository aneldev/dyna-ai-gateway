import {dynaError} from "dyna-error";

import {makeOwnerKey} from "./createBackgroundTasks";

/** The calls of each user in flight on this instance, and the users being erased. */
export interface IUserCalls {
  /**
   * Marks a call of these users as in flight and returns the function that ends it. A user being erased is a 409: a call
   * that started after the erasure would write the user's data again.
   */
  begin(args: {tenantId: string; userIds: string[]}): () => void;

  /** Refuses new calls of the user, waits for the ones in flight, runs `work`, then lets calls in again. */
  whileErasing<T>(args: {tenantId: string; userId: string}, work: () => Promise<T>): Promise<T>;
}

/**
 * The guard of the GDPR erasure against the user's own calls: none starts while the user is erased, and the erasure waits
 * for the ones that are running, so nothing they write (a turn, a trace entry, a remembered fact) survives it. Per process:
 * calls on another instance are not seen.
 */
export const createUserCalls = (): IUserCalls => {
  const inFlight = new Map<string, Set<Promise<void>>>();
  const erasing = new Set<string>();

  return {
    begin: ({
      tenantId,
      userIds,
    }): () => void => {
      const owners = [...new Set(userIds)].map(userId => makeOwnerKey(tenantId, userId));
      const erased = owners.find(owner => erasing.has(owner));
      if (erased !== undefined) {
        throw dynaError({
          code: 5377210486211,
          status: 409,
          message: `AIGateway: the data of a user of tenant [${tenantId}] is being erased; the call is refused`,
          userMessage: "Your data is being deleted right now; please try again later",
          data: {tenantId},
        });
      }
      let end = (): void => undefined;
      const done = new Promise<void>(resolve => {
        end = resolve;
      });
      owners.forEach(owner => inFlight.set(owner, (inFlight.get(owner) ?? new Set()).add(done)));
      return (): void => {
        end();
        owners.forEach(owner => {
          const calls = inFlight.get(owner);
          calls?.delete(done);
          if (calls?.size === 0) inFlight.delete(owner);
        });
      };
    },
    whileErasing: async ({
      tenantId,
      userId,
    }, work) => {
      const owner = makeOwnerKey(tenantId, userId);
      erasing.add(owner);
      try {
        for (let calls = inFlight.get(owner); calls?.size; calls = inFlight.get(owner)) await Promise.all(calls);
        return await work();
      }
      finally {
        erasing.delete(owner);
      }
    },
  };
};
