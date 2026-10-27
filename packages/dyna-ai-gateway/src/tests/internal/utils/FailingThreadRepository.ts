import {dynaError} from "dyna-error";

import {
  ITurn,
  InMemoryThreadRepository,
} from "../../..";

/** Armed by a test: the next `loadTurns` of the thread store fails once, then the store works again. */
export const threadStoreFailure = {armed: false};

/** The code of the failure `FailingThreadRepository` throws. */
export const THREAD_STORE_FAILURE_CODE = 5376412760097;

/** A thread store whose next `loadTurns` fails when armed: the read `closeRun` starts with breaks. */
export class FailingThreadRepository extends InMemoryThreadRepository {
  public async loadTurns(
    args: {
      tenantId: string;
      threadId: string;
      desc: boolean;
      skip: number;
      limit: number;
    },
  ): Promise<ITurn[]> {
    if (!threadStoreFailure.armed) return super.loadTurns(args);
    threadStoreFailure.armed = false;
    throw dynaError({
      code: THREAD_STORE_FAILURE_CODE,
      status: 503,
      message: "Test: the thread store is unavailable",
    });
  }
}
