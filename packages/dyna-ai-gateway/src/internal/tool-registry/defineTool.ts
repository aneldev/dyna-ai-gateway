import {IToolDef} from "../../contracts";

/**
 * defineTool -- declares a tool with its input and output types inferred
 *
 * # About
 *
 * > Write the schema once; `execute` gets the typed input for free.
 *
 * An identity function that lets TypeScript infer `TInput` from `inputSchema` and `TOutput` from what `execute` returns,
 * so `execute`, `policy`, `endsRun` and `visibleWhen` are written against a typed `input` instead of `unknown`. Nothing
 * is validated or registered here: the `ToolRegistry` does that at construction.
 *
 * # Who needs it
 *
 * The application, for every tool of `IToolRegistryConfig.tools` and of a call's `additionalTools`; the gateway's own
 * built-in tools (`makeUserMemoryTools`, `makeAskUserQuestionTool`, `SkillRegistry.makeLoadSkillTool`).
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, when a tool literal is written: an `IToolDef` typed by hand loses the inference.
 *
 * # Pitfalls
 *
 * The type of `execute`'s result is the type the model reads as JSON: a `Date`, a `Map` or a class instance serialises
 * badly. Return plain data.
 */
export const defineTool = <TInput, TOutput>(tool: IToolDef<TInput, TOutput>): IToolDef<TInput, TOutput> => tool;
