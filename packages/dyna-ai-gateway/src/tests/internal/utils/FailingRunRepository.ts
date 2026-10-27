import {dynaError} from "dyna-error";

import {
  IRun,
  InMemoryRunRepository,
} from "../../..";

/** Armed by a test: the next `save` of the run store fails once, then the store works again. */
export const runStoreFailure = {armed: false};

/** The code of the failure `FailingRunRepository` throws. */
export const RUN_STORE_FAILURE_CODE = 5376412760092;

/** A run store whose next `save` fails when armed: a resume breaks on the profile switch or inside its settlement. */
export class FailingRunRepository extends InMemoryRunRepository {
  public async save(args: {run: IRun}): Promise<void> {
    if (!runStoreFailure.armed) return super.save(args);
    runStoreFailure.armed = false;
    throw dynaError({
      code: RUN_STORE_FAILURE_CODE,
      status: 503,
      message: "Test: the run store is unavailable",
    });
  }
}
