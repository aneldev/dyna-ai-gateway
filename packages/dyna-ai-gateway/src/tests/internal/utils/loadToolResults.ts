import {
  IAIGatewayConfig,
  IToolResultPart,
  EPartKind,
} from "../../..";

import {sampleUser} from "../samples/profiles";

/** The tool results stored on a thread of the sample tenant, in turn order: what the tools of a run produced. */
export const loadToolResults = async (
  {
    config,
    threadId,
  }: {
    config: IAIGatewayConfig;
    threadId: string;
  },
): Promise<IToolResultPart[]> => {
  const turns = await config.threadStore.repository.loadTurns({
    tenantId: sampleUser.tenantId,
    threadId,
    desc: false,
    skip: 0,
    limit: 100,
  });
  return turns
    .flatMap(turn => turn.parts)
    .filter((part): part is IToolResultPart => part.kind === EPartKind.TOOL_RESULT);
};
