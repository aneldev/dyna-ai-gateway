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

/** The owner of background work: a user of a tenant. */
export const makeOwnerKey = (tenantId: string, userId: string): string => JSON.stringify([tenantId, userId]);

/**
 * The gateway's background queue: one line of tasks per key (a thread),
 * so two memory updates of a thread never overlap.
 * A task that throws is reported and does not stop the tasks behind it.
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
