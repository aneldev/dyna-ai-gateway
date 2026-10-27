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
  structured: TStructured | undefined;
  issues: IIssue[];
  ok: boolean;
  /** The trace entries of the judge calls of the check, annotated with the issues by the caller (D73). */
  traceIds: string[];
}

/** Step 8: Guardrails on the output — the built-in checks, then the app's output rules. */
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
