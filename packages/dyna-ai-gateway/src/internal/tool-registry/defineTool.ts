import {IToolDef} from "../../contracts";

/**
 * Declares a tool with its types inferred: TInput from `inputSchema`, TOutput from what `execute` returns.
 * `execute` then receives a typed `input` instead of `unknown`.
 */
export const defineTool = <TInput, TOutput>(tool: IToolDef<TInput, TOutput>): IToolDef<TInput, TOutput> => tool;
