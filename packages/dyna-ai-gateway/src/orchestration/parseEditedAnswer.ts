import {dynaError} from "dyna-error";
import {ZodType} from "zod";

import {
  IRun,
  IResumeDecision,
} from "../internal";
import {IAIGatewayDeps} from "../types";

/** The token estimator of the answer's size: a token is about 4 characters. */
const CHARS_PER_TOKEN = 4;

/** The reviewer's text, parsed through the run's schema when it had one. */
export interface IEditedAnswer {
  text: string;
  /** The parsed, schema-checked value of the edited text; present when the run had an `outputSchema`. */
  structured?: unknown;
}

/**
 * parseEditedAnswer -- the answer a reviewer typed instead of the model's (D99)
 *
 * # About
 *
 * > The reviewer is trusted, the schema still holds.
 *
 * `editedInput` of an EDIT on a reviewed answer must be a string: the new text of the answer. A run started with an
 * `outputSchema` parses it again (`Guardrails.parseStructured`) with the schema `resume` was given (a stored run keeps none,
 * D36), because the caller's code reads `structured`; the output rules do not run on it, a reviewer's text is the app's own
 * like `instructions`. A non-string and a text the schema rejects are 400s, and so is a text longer than the model's own
 * answer may be (`maxOutputTokens` × 4 characters): the edit is stored as the assistant's turn and goes back to the model as
 * history. An answer that has a `structured` value resumed without the schema is refused too: the edited text would be
 * delivered next to the model's unreviewed value.
 *
 * # Who needs it
 *
 * `AIGateway.continueReview`, before the run leaves PAUSED: a refused edit leaves the run paused for another decision.
 */
export const parseEditedAnswer = <TStructured>(
  {
    deps,
    run,
    decision,
    outputSchema,
  }: {
    deps: IAIGatewayDeps;
    run: IRun;
    decision: IResumeDecision;
    /** The schema the run was started with, handed to `resume` again (D36); omitted for a plain-text answer. */
    outputSchema?: ZodType<TStructured>;
  },
): IEditedAnswer => {
  const text = decision.editedInput;
  if (typeof text !== "string") {
    throw dynaError({
      code: 5377120443047,
      status: 400,
      message: `AIGateway: the EDIT of the reviewed answer of run [${run.id}] needs the edited text as a string in editedInput`,
      data: {
        runId: run.id,
        editedInputType: typeof text,
      },
    });
  }
  const maxChars = run.request.maxOutputTokens * CHARS_PER_TOKEN;
  if (text.length > maxChars) {
    throw dynaError({
      code: 5377210486181,
      status: 400,
      message: `AIGateway: the edited answer of run [${run.id}] has ${text.length} characters, over the ${maxChars} the model's answer may have`,
      data: {
        runId: run.id,
        length: text.length,
        maxChars,
      },
    });
  }
  if (!outputSchema && run.answer?.structured !== undefined) {
    throw dynaError({
      code: 5377210486183,
      status: 400,
      message: `AIGateway: the reviewed answer of run [${run.id}] is structured but the resume brought no outputSchema to parse the edit with; resume with the schema the run started with`,
      data: {runId: run.id},
    });
  }
  if (!outputSchema) return {text};
  const parsed = deps.guardrails.parseStructured({
    text,
    schema: outputSchema,
  });
  if (parsed.structured === undefined) {
    throw dynaError({
      code: 5377120443059,
      status: 400,
      message: `AIGateway: the edited answer of run [${run.id}] does not match the run's output schema`,
      data: {
        runId: run.id,
        issues: parsed.issues,
      },
    });
  }
  return {
    text,
    structured: parsed.structured,
  };
};
