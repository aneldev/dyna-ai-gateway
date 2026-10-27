import {dynaError} from "dyna-error";

import {IToolDef} from "../contracts";
import {IAIGatewayDeps} from "../types";

/**
 * The tools of a stored run, for `ToolPolicy.resolve` on resume: the registry's by name, the additional ones (D66) from what the
 * resume passes again. A name found in neither is a 400: the caller must pass the `additionalTools` the run started with.
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
  const missing = toolNames.filter(name => !registryNames.has(name) && !additionalTools.some(tool => tool.name === name));
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
