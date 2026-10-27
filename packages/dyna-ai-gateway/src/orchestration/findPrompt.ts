import {EPartKind} from "../contracts";
import {
  IMessage,
  EMessageRole,
} from "../internal";

/** The user's question of a request: the text of its last user message (tool results come in TOOL messages). */
export const findPrompt = (
  {messages}: {messages: IMessage[]},
): string => {
  const question = messages.filter(message => message.role === EMessageRole.USER).at(-1);
  return (question?.parts ?? [])
    .map(part => part.kind === EPartKind.TEXT ? part.text : "")
    .filter(Boolean)
    .join("\n");
};
