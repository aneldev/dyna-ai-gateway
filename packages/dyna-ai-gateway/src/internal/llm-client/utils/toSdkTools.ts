import {
  ToolSet,
  tool,
} from "ai";

import {IToolDef} from "../../../contracts";

/**
 * toSdkTools -- our tool definitions as SDK tools without an executor
 *
 * # About
 *
 * > The SDK may only report that the model asked for a tool; running it stays with the loop.
 *
 * One SDK `tool` per definition with its description and input schema and no `execute`, so the call returns the request and
 * the hooks decide (approvals, denials, D87). With `cacheLast` the last tool carries Anthropic's cache marker: the tool
 * definitions render before the system prompt, so a marker there is a read point for the tools alone.
 *
 * # Who needs it
 *
 * `LLMClient.complete`, on every call.
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
