import {dynaError} from "dyna-error";

import {
  IAIGatewayConfig,
  IThread,
  InMemoryRunRepository,
  InMemoryThreadRepository,
  ERunStatus,
} from "../..";

import {gatewayConfigAbortedResume} from "./aborted-resume.config";

/** The controller of the resume under test and its run; the thread store presses "stop" when both are set, then fails its read. */
export const storeFailure: {controller?: AbortController; runId?: string} = {};

const runRepository = new InMemoryRunRepository();

/**
 * A thread store that breaks once, as the stop is pressed: the read of the thread's turn count after the run left PAUSED (it is
 * RUNNING then) and before the model is called finds the signal aborted and a store error at once.
 */
class FailingThreadRepository extends InMemoryThreadRepository {
  public async loadThread(
    args: {
      tenantId: string;
      threadId: string;
    },
  ): Promise<IThread | null> {
    const {
      controller,
      runId,
    } = storeFailure;
    if (controller && runId) {
      const run = await runRepository.load({
        tenantId: args.tenantId,
        runId,
      });
      if (run?.status === ERunStatus.RUNNING) {
        storeFailure.controller = undefined;
        controller.abort();
        throw dynaError({
          code: 5376412760087,
          status: 503,
          message: "Test: the thread store is unavailable",
        });
      }
    }
    return super.loadThread(args);
  }
}

/** The slow refund of `gatewayConfigAbortedResume` on a thread store that can fail on demand. */
export const gatewayConfigAbortedResumeStoreFailure: IAIGatewayConfig = {
  ...gatewayConfigAbortedResume,
  threadStore: {repository: new FailingThreadRepository()},
  runStore: {repository: runRepository},
};
