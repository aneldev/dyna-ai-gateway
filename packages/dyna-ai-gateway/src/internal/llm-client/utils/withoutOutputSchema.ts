/**
 * withoutOutputSchema -- a request without its zod schema
 *
 * # About
 *
 * > A schema is code, not data: nothing stored carries it (D36).
 *
 * A copy of the request without `outputSchema`, so a trace entry and a paused run can be written to a database; whoever
 * resumes a run hands the schema in again (`AIGateway.resume`).
 *
 * # Who needs it
 *
 * `LLMClient`, for the request of a trace entry; `settleRun` and `settleReviewPause`, for the request of a paused run.
 */
export const withoutOutputSchema = <TRequest extends {outputSchema?: unknown}>(request: TRequest): Omit<TRequest, "outputSchema"> => {
  const {
    outputSchema: _outputSchema,
    ...rest
  } = request;
  return rest;
};
