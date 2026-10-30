import {
  ToolSet,
  tool,
} from "ai";

import {IToolDef} from "../../../contracts";

/**
 * Our tool definitions → SDK tools **without an executor**: the SDK can only report that the model asked for a tool;
 * running it stays with the caller (hooks, approvals). With `cacheLast` the last tool carries Anthropic's cache marker:
 * the tool definitions render before the system prompt, so a marker there is a read point for the tools alone.
 */
export const toSdkTools = (
  {
    tools,
    cacheLast = false,
  }: {
    tools: IToolDef[];
    /** Anthropic only (the Bedrock provider takes no marker on a tool), and only when the request says the tool definitions may be cached (`IModelRequest.cacheTools`). */
    cacheLast?: boolean;
  },
): ToolSet =>
  Object.fromEntries(
    tools.map((definition, index) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        ...cacheLast && index === tools.length - 1 && {providerOptions: {anthropic: {cacheControl: {type: "ephemeral"}}}},
      }),
    ]),
  );
