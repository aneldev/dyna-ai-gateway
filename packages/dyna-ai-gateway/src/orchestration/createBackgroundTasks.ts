/** Work the gateway does after it answered, without making the caller wait. */
export interface IBackgroundTasks {
  /**
   * Starts the task after the earlier tasks of the same key; tasks of different keys run side by side. Never throws.
   * `owner` names whose data the task writes (`makeOwnerKey`), so the erasure of that user waits for it.
   */
  run(key: string, task: () => Promise<void>, owner?: string): void;

  /**
   * Resolves when no task is left, including the ones that were started while waiting. With `owner`, only that user's
   * tasks are waited for: the erasure of one user does not wait for the busy queues of every tenant.
   */
  whenIdle(owner?: string): Promise<void>;
}

/**
 * makeOwnerKey -- the key of a user of a tenant
 *
 * # About
 *
 * > One string for "this user of this tenant", the same wherever it is built.
 *
 * Names whose data a background task writes and whose calls are in flight, so an erasure (`AIGateway.deleteUserData`,
 * `anonymizeUserData`) waits for exactly that user's work. The one key of `IBackgroundTasks.run`'s `owner` and of `IUserCalls`.
 */
export const makeOwnerKey = (tenantId: string, userId: string): string => JSON.stringify([tenantId, userId]);

/**
 * createBackgroundTasks -- the gateway's background queue
 *
 * # About
 *
 * > One line of tasks per key, so two memory updates of a thread never overlap.
 *
 * Builds the `IBackgroundTasks` of one gateway: `run` appends a task to the line of its key (a thread) and returns at once,
 * `whenIdle` waits for every line, or for one user's. A task that throws is logged (`5372600823804`) and does not stop the
 * tasks behind it. Nothing is polled: a line is a chain of promises, kept only while it has work.
 *
 * Created once, in the constructor of `AIGateway`; fed by `scheduleMemory` after every ANSWER (the working-memory update
 * and the fact extraction, D122) and by `resetThreadMemory`; drained by `AIGateway.whenIdle` and `shutdown`, and per user by
 * `forgetUser` and `deleteThreads`.
 *
 * # Who needs it
 *
 * The constructor of `AIGateway`.
 *
 * # Pitfalls
 *
 * Per process: a task of another instance is not seen. A task that never settles blocks its key for good and keeps
 * `whenIdle` waiting; give long work the call's signal.
 */
export const createBackgroundTasks = (): IBackgroundTasks => {
  // Per key, the tail promise of a `.then` chain: the chain is the queue.
  // `run` appends the task to the tail and stores the new tail; no array, no polling.
  const queues = new Map<string, Promise<void>>();
  // Per key, the user whose data its tasks write: a thread is one user's
  const owners = new Map<string, string>();

  return {
    run: (key, task, owner): void => {
      if (owner !== undefined) owners.set(key, owner);
      const queue =
        (queues.get(key) ?? Promise.resolve())
          .then(task)
          .catch((error: unknown) => console.error(`Internal error 5372600823804: AIGateway: the background task of [${key}] failed`, error))
          .then(() => {
            if (queues.get(key) !== queue) return;
            queues.delete(key);
            owners.delete(key);
          });
      queues.set(key, queue);
    },
    whenIdle: async (owner): Promise<void> => {
      const pending = (): Array<Promise<void>> => [...queues.entries()]
        .filter(([key]) => owner === undefined || owners.get(key) === owner)
        .map(([, queue]) => queue);
      for (let tails = pending(); tails.length; tails = pending()) await Promise.all(tails);
    },
  };
};
