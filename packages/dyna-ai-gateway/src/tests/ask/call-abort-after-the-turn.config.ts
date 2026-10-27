import {
  IAIGatewayConfig,
  IThreadRepository,
  InMemoryThreadRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The controller of the call under test; the repository presses "stop" on it when one is set. */
export const callAbortAfterTheTurn: {controller?: AbortController} = {};

/**
 * The in-memory thread repository, pressing "stop" on `callAbortAfterTheTurn.controller` right after a turn is stored: the abort
 * lands when the call's thread exists and holds the user turn, before the knowledge-base search and the model call.
 */
class StopAfterTheTurnThreadRepository extends InMemoryThreadRepository {
  public async appendTurn(args: Parameters<IThreadRepository["appendTurn"]>[0]): Promise<void> {
    await super.appendTurn(args);
    callAbortAfterTheTurn.controller?.abort();
  }
}

/** Plain chat on the repository that aborts the call once the user turn is stored. */
export const gatewayConfigCallAbortAfterTheTurn: IAIGatewayConfig = {
  ...gatewayConfigBase,
  threadStore: {repository: new StopAfterTheTurnThreadRepository()},
};
