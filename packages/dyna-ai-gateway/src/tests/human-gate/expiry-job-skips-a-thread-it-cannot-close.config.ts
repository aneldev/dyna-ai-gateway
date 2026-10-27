import {dynaError} from "dyna-error";

import {
  IAIGatewayConfig,
  IThreadRepository,
  InMemoryThreadRepository,
} from "../..";

import {gatewayConfigExpiringPause} from "./expiring-pause.config";

/** Thread ids whose turns cannot be appended: the "broken" threads of the scenario. */
export const brokenThreadIds = new Set<string>();

/** The in-memory thread repository, except that appending a turn to a broken thread fails as a database would. */
class BrokenAppendThreadRepository extends InMemoryThreadRepository {
  public async appendTurn(args: Parameters<IThreadRepository["appendTurn"]>[0]): Promise<void> {
    if (brokenThreadIds.has(args.threadId)) {
      throw dynaError({
        code: 5375202005325,
        status: 503,
        message: "Thread repository: write failed",
        data: {threadId: args.threadId},
      });
    }
    return super.appendTurn(args);
  }
}

/** The expiring-pause scenario on a thread repository that can fail on one thread. */
export const gatewayConfigExpiryJobBrokenThread: IAIGatewayConfig = {
  ...gatewayConfigExpiringPause,
  threadStore: {repository: new BrokenAppendThreadRepository()},
};
