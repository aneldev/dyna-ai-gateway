import {
  IAIGatewayConfig,
  IToolErrorReport,
} from "../..";

import {
  chargeCardTool,
  gatewayConfigThrowingTool,
} from "./throwing-tool.config";

/** Every report the handler received; a test empties it before its run. */
export const toolErrorReports: IToolErrorReport[] = [];

/** The throwing-tool scenario with a developer listening: `onToolError` collects every failed call. */
export const gatewayConfigOnToolError: IAIGatewayConfig = {
  ...gatewayConfigThrowingTool,
  toolRegistry: {
    tools: [chargeCardTool],
    onToolError: (report): void => {
      toolErrorReports.push(report);
    },
  },
};
