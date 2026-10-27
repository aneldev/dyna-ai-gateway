import {IAIGatewayConfig} from "../..";

import {
  chargeCardTool,
  gatewayConfigThrowingTool,
} from "./throwing-tool.config";

/** What the broken handler throws. */
export const HANDLER_FAILURE_MESSAGE = "the metrics sink is down";

/** The throwing-tool scenario with a developer handler that is itself broken: `onToolError` throws on every report. */
export const gatewayConfigOnToolErrorThatThrows: IAIGatewayConfig = {
  ...gatewayConfigThrowingTool,
  toolRegistry: {
    tools: [chargeCardTool],
    onToolError: (): void => {
      throw new Error(HANDLER_FAILURE_MESSAGE);
    },
  },
};
