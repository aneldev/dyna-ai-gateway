import {IAIGatewayDeps} from "../types";

/**
 * withThreadLease -- runs one call as the only call on its thread
 *
 * # About
 *
 * > Take the lease, do the call, give the lease back.
 *
 * Takes the thread's lease (D77) before `run` and releases it in a `finally`, whatever `run` did: answered, failed, paused or
 * threw. A thread that is busy is a 409 from `ThreadStore.acquireLease`, and `run` never starts. Without a `threadId` the call
 * creates its thread, nobody else knows its id yet, so there is nothing to lease.
 *
 * `AIGateway.ask`, `AIGateway.run` and `AIGateway.resume` wrap their work in it.
 *
 * # Pitfalls
 *
 * A release that fails is logged, not thrown: the call's own result or error is what the caller gets, and the lease expires by itself.
 */
export const withThreadLease = async <T>(
  {
    deps,
    tenantId,
    threadId,
    run,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    /** The thread of the call; omitted when the call creates it. */
    threadId?: string;
    run: () => Promise<T>;
  },
): Promise<T> => {
  if (!threadId) return run();
  const token = await deps.threadStore.acquireLease({
    tenantId,
    threadId,
  });
  try {
    return await run();
  }
  finally {
    try {
      await deps.threadStore.releaseLease({
        tenantId,
        threadId,
        token,
      });
    }
    catch (error) {
      console.error(`Internal error 5375384011275: AIGateway: could not release the lease of thread [${threadId}]`, error);
    }
  }
};
