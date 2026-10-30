import {ISystemBlock} from "./types";

/**
 * joinSystem -- the system blocks of a request as one text
 *
 * # About
 *
 * > One string for whoever cannot take blocks.
 *
 * Joins the texts of the blocks with a blank line between them, in order; the cache marks are dropped. The one place the
 * join is defined, so a provider without cache markers, the token count and the debug view all see the same text.
 *
 * # Who needs it
 *
 * `LLMClient.complete` / `run` for a provider that takes the system prompt as one string, `estimateRequestTokens`, and
 * the `debug.system` of an answer (`AIGateway.ask`, `settleRun`, `settleReview`).
 */
export const joinSystem = (
  {blocks}: { blocks: ISystemBlock[] },
): string => blocks.map(block => block.text).join("\n\n");
