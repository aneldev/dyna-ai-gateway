import {
  IAIGatewayConfig,
  IToolErrorReport,
} from "../..";

import {gatewayConfigGuardedTools} from "./guarded-tools.config";

/** Every report the handler received; a test empties it before its run. */
export const guardedToolErrorReports: IToolErrorReport[] = [];

/** The guarded-tools scenario (D15) with a developer listening: `onToolError` collects every failed call, the step refusals included. */
export const gatewayConfigGuardedToolsReported: IAIGatewayConfig = {
  ...gatewayConfigGuardedTools,
  toolRegistry: {
    ...gatewayConfigGuardedTools.toolRegistry,
    onToolError: (report): void => {
      guardedToolErrorReports.push(report);
    },
  },
};
