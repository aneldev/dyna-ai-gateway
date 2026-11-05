import {EPartKind} from "../contracts";
import {
  IMessage,
  EMessageRole,
} from "../internal";

/**
 * findPrompt -- the user's question out of the messages of a request
 *
 * # About
 *
 * > The text parts of the last USER message, joined; tool results live in TOOL messages and are never mistaken for it.
 *
 * The output rules judge the answer against the question; this is how `executeAsk` and `settleRun` find it in the request
 * they sent.
 *
 * # Who needs it
 *
 * `AIGateway.executeAsk` and `settleRun`, for `checkOutput`.
 */
export const findPrompt = (
  {messages}: {messages: IMessage[]},
): string => {
  const question = messages.filter(message => message.role === EMessageRole.USER).at(-1);
  return (question?.parts ?? [])
    .map(part => part.kind === EPartKind.TEXT ? part.text : "")
    .filter(Boolean)
    .join("\n");
};
