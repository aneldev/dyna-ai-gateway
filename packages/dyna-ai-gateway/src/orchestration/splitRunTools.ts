import {dynaError} from "dyna-error";

import {
  IToolDef,
  BUILT_IN_TOOL_NAMES,
  BUILT_IN_TOOL_NAME_PREFIX,
} from "../contracts";
import {IAIGatewayDeps} from "../types";

/** The built-in names before the prefix: a stored run that still needs one cannot be resumed. */
const LEGACY_BUILT_IN_TOOL_NAMES: string[] = ["ask_user_question", "load_skill", "remember_user_fact", "forget_user_fact"];

/**
 * splitRunTools -- the tools of a stored run, found again for its resume
 *
 * # About
 *
 * > A run stores tool names; the resume needs the tools.
 *
 * Splits `IRun.toolNames` for `ToolPolicy.resolve`: the registry's tools by name (`allTools`), the additional ones (D66) from
 * what the resume passes again (`additionalTools`, narrowed to the run's names). A name found in neither is a 400: the
 * caller must pass the `additionalTools` the run started with. `dyna_aigw_load_skill` is neither and is left out: the
 * resume rebuilds it from the run's and the profile's skills (D124). A name found in neither that is an old, unprefixed
 * built-in name (`ask_user_question`, …) is a 400 of its own: the run was stored before the rename and cannot continue.
 *
 * Runs in `continueRun` after the profile of the resume is known and before `ToolPolicy.resolve`.
 *
 * # Who needs it
 *
 * `AIGateway.continueRun`.
 */
export const splitRunTools = (
  {
    deps,
    runId,
    toolNames,
    additionalTools,
  }: {
    deps: IAIGatewayDeps;
    runId: string;
    /** `IRun.toolNames`. */
    toolNames: string[];
    /** `resume({additionalTools})`. */
    additionalTools: IToolDef[];
  },
): {
  allTools: IToolDef[];
  additionalTools: IToolDef[];
} => {
  const registryNames = new Set(deps.toolRegistry.list().map(tool => tool.name));
  const missing = toolNames.filter(name => name !== BUILT_IN_TOOL_NAMES.LOAD_SKILL && !registryNames.has(name) && !additionalTools.some(tool => tool.name === name));
  // An old built-in name the app now uses for its own tool is found above, so only the stale ones are left here
  const legacyNames = missing.filter(name => LEGACY_BUILT_IN_TOOL_NAMES.includes(name));
  if (legacyNames.length > 0) {
    throw dynaError({
      code: 5387318840411,
      status: 400,
      message: `AIGateway: run [${runId}] was stored with the old names of the built-in tools [${legacyNames.join(", ")}]; they are named ${BUILT_IN_TOOL_NAME_PREFIX}<name> now and the run cannot be resumed, start a new one`,
      userMessage: "This conversation was paused by an older version and cannot continue, please start it again",
      data: {
        runId,
        legacyTools: legacyNames,
      },
    });
  }
  if (missing.length > 0) {
    throw dynaError({
      code: 5374506419225,
      status: 400,
      message: `AIGateway: run [${runId}] started with additionalTools [${missing.join(", ")}]; pass them again in resume({additionalTools})`,
      data: {
        runId,
        missingTools: missing,
      },
    });
  }
  return {
    allTools: toolNames.filter(name => registryNames.has(name)).map(name => deps.toolRegistry.get({name})),
    additionalTools: additionalTools.filter(tool => toolNames.includes(tool.name)),
  };
};
