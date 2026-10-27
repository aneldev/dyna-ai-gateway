import {
  ToolSet,
  tool,
} from "ai";

import {IToolDef} from "../../../contracts";

/**
 * Our tool definitions → SDK tools **without an executor**: the SDK can only report that the model asked for a tool;
 * running it stays with the caller (hooks, approvals).
 */
export const toSdkTools = (tools: IToolDef[]): ToolSet =>
  Object.fromEntries(
    tools.map(definition => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
      }),
    ]),
  );
