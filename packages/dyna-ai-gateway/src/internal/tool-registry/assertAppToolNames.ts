import {dynaError} from "dyna-error";

import {
  IToolDef,
  BUILT_IN_TOOL_NAME_PREFIX,
} from "../../contracts";

/**
 * assertAppToolNames -- refuses an application tool whose name takes the built-in prefix
 *
 * # About
 *
 * > `dyna_aigw_` belongs to the gateway, every other name to the application.
 *
 * Throws a 400 naming every tool of `tools` whose name starts with `BUILT_IN_TOOL_NAME_PREFIX`, so an application tool
 * can never collide with a built-in one, present or future. Any other name is the application's, an old unprefixed
 * built-in name (`ask_user_question`) included.
 *
 * # Who needs it
 *
 * `createGatewayDeps` for `toolRegistry.tools`, before the registry is built; `ToolPolicy.resolve` for the
 * `additionalTools` of a call.
 *
 * # Pitfalls
 *
 * Never call it on a list that holds the built-ins themselves: they carry the prefix and would be refused.
 */
export const assertAppToolNames = (
  {
    tools,
    source,
  }: {
    tools: IToolDef[];
    /** Where the tools came from, for the message. */
    source: "toolRegistry.tools" | "additionalTools";
  },
): void => {
  const reserved = tools
    .map(tool => tool.name)
    .filter(name => name.startsWith(BUILT_IN_TOOL_NAME_PREFIX));
  if (reserved.length === 0) return;
  throw dynaError({
    code: 5387318840422,
    status: 400,
    message: `ToolRegistry: ${source} name tools with the prefix [${BUILT_IN_TOOL_NAME_PREFIX}] reserved for the built-in tools: ${reserved.join(", ")}`,
    data: {
      source,
      reservedTools: reserved,
    },
  });
};
