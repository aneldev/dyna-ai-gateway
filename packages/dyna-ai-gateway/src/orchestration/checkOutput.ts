import {
  IChunk,
  IIssue,
  IToolResultPart,
  IUserContext,
} from "../contracts";
import {
  IAIProfile,
  IModelResult,
} from "../internal";
import {
  IAIGatewayDeps,
  IGatewayAskInput,
} from "../types";

/** What the output checks found. */
export interface ICheckedOutput<TStructured> {
  /** The parsed value of the answer when the call had an `outputSchema` and the text matched it. */
  structured: TStructured | undefined;
  /** The issues collected before the model call, followed by the output check's own. */
  issues: IIssue[];
  /** False when a built-in check or an output rule blocked the answer: it is withdrawn, not delivered. */
  ok: boolean;
  /** The trace entries of the judge calls of the check, annotated with the issues by the caller (D73). */
  traceIds: string[];
}

/**
 * checkOutput -- the output check of an answer, with the issues of the call so far
 *
 * # About
 *
 * > Step 8: the built-in checks, then the app's output rules, on what the model answered.
 *
 * Hands the model's result to `Guardrails.checkOutput` with its evidence (the question, the knowledge-base chunks of the
 * request, the tool results of the run) and returns the verdict with the call's earlier issues in front of the check's own.
 * The judge calls of the rules run under the call's signal; their trace ids come back for `annotateJudgeTraces`.
 *
 * Runs right after `LLMClient.complete` or `LLMClient.run` returned a result and before any turn is stored: a blocked answer
 * is never stored as the assistant's text (D70).
 *
 * # Who needs it
 *
 * `AIGateway.executeAsk` and `settleRun`.
 *
 * # Pitfalls
 *
 * Throws the signal's reason when the call is aborted during a judge call, and the usage-denied error when the usage
 * adapter refuses a judge call: the callers settle both as a withdrawn answer.
 */
export const checkOutput = async <TStructured>(
  {
    deps,
    result,
    outputSchema,
    prompt,
    userContext,
    profile,
    threadId,
    chunks,
    toolResults,
    issues,
    abortSignal,
  }: {
    deps: IAIGatewayDeps;
    result: IModelResult;
    outputSchema: IGatewayAskInput<TStructured>["outputSchema"];
    /** The user's question the answer is for. */
    prompt: string;
    userContext: IUserContext;
    profile: IAIProfile;
    threadId: string;
    /** The knowledge-base chunks that were in the request; none on a resume. */
    chunks: IChunk[];
    toolResults: IToolResultPart[];
    /** Issues collected before the model call (the assembler's warnings). */
    issues: IIssue[];
    /** The call's signal, for the output rules and their judge calls. */
    abortSignal?: AbortSignal;
  },
): Promise<ICheckedOutput<TStructured>> => {
  const outputCheck = await deps.guardrails.checkOutput({
    result,
    schema: outputSchema,
    prompt,
    chunks,
    toolResults,
    userContext,
    profile,
    threadId,
    abortSignal,
  });
  return {
    structured: outputCheck.structured,
    issues: [...issues, ...outputCheck.issues],
    ok: outputCheck.ok,
    traceIds: outputCheck.traceIds,
  };
};
