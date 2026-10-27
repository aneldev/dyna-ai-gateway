import {ITurn} from "../contracts";
import {IAIGatewayDeps} from "../types";

/** Appends the turns to the thread, in order. */
export const appendTurns = async (
  {
    deps,
    tenantId,
    threadId,
    turns,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    threadId: string;
    turns: ITurn[];
  },
): Promise<void> => {
  for (const turn of turns) {
    await deps.threadStore.appendTurn({
      tenantId,
      threadId,
      turn,
    });
  }
};
