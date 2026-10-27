import {DEFAULT_TOOL_REJECTION_TEXT} from "../../../contracts";

/**
 * makeRejectionOutput -- the text the model reads for a tool call a human rejected
 *
 * # About
 *
 * > The lead says the tool did not run; the human's reason follows, when there is one.
 *
 * The lead is the `rejectionText` the tool's policy gave for this call (D87), else `DEFAULT_TOOL_REJECTION_TEXT`. A bare reason
 * never reaches the model on its own: an empty tool result reads as "ran, returned nothing" and is reported as success.
 *
 * # Who needs it
 *
 * The agent loop, for a REJECT decision; `closeRun`, when a cancelled or expired pause closes its pending call as rejected.
 */
export const makeRejectionOutput = (
  {
    rejectionText,
    reason,
  }: {
    /** The policy's text for this call; omitted = the default. */
    rejectionText?: string;
    /** The human's reason; empty or missing = the lead alone. */
    reason?: string;
  },
): string => {
  const lead = rejectionText ?? DEFAULT_TOOL_REJECTION_TEXT;
  const trimmed = reason?.trim() ?? "";
  return trimmed ? `${lead} Reason: ${trimmed}` : lead;
};
