import {EPartKind} from "../../contracts";
import {
  countFileTokens,
  countTokens,
} from "../../utils/tokens/countTokens";

import {EModelProvider} from "../model-registry";

import {
  IMessage,
  IModelRequest,
  TMessagePart,
} from "./types";

/**
 * estimateRequestTokens -- the token count of a model request
 *
 * # About
 *
 * > One count for the whole gateway: what the ContextAssembler trims with is what the UsageGuard is asked with.
 *
 * Counts the system prompt and every message with `countTokens` (a real tokenizer for OpenAI, a safe factor on top for the
 * other providers): a text part by its text, a tool call and a tool result by their name and their JSON, an inline file by
 * `countFileTokens` (image size or PDF pages).
 *
 * # Who needs it
 *
 * `ContextAssembler.estimateTokens` while it trims a request to the context window; the `LLMClient` for the `neededTokens` of
 * every `UsageGuard.check`; the `FakeLLMClient` of the tests, without a provider.
 *
 * # Pitfalls
 *
 * Still an estimate for every provider but OpenAI, and for every file: compare sizes with it, do not bill with it.
 */
export const estimateRequestTokens = (
  {
    request,
    provider,
  }: {
    request: IModelRequest;
    /** The model's provider; omit when unknown, the safe factor is applied then. */
    provider?: EModelProvider;
  },
): number => {
  const system = countTokens({
    text: request.system,
    provider,
  });
  return system + estimateMessagesTokens({
    messages: request.messages,
    provider,
  });
};

/**
 * estimateMessagesTokens -- the token count of a list of messages
 *
 * # About
 *
 * > The same count as `estimateRequestTokens`, without a system prompt.
 *
 * Sums every message of the list, part by part, the way `estimateRequestTokens` does for a whole request.
 *
 * # Who needs it
 *
 * `estimateRequestTokens` for the messages of a request; the `WorkingMemory` while it fits turns into the history budget.
 */
export const estimateMessagesTokens = (
  {
    messages,
    provider,
  }: {
    messages: IMessage[];
    /** The model's provider; omit when unknown, the safe factor is applied then. */
    provider?: EModelProvider;
  },
): number => messages.reduce((sum, message) => sum + countMessage(message, provider), 0);

const countMessage = (message: IMessage, provider: EModelProvider | undefined): number =>
  message.parts.reduce((sum, part) => sum + countPart(part, provider), 0);

const countPart = (part: TMessagePart, provider: EModelProvider | undefined): number => {
  switch (part.kind) {
    case EPartKind.TEXT:
      return countTokens({
        text: part.text,
        provider,
      });
    case EPartKind.TOOL_CALL:
      return countTokens({
        text: part.toolName + JSON.stringify(part.input ?? null),
        provider,
      });
    case EPartKind.TOOL_RESULT:
      return countTokens({
        text: part.toolName + JSON.stringify(part.output ?? null),
        provider,
      });
    case EPartKind.INLINE_FILE:
      return countFileTokens({
        file: part,
        provider,
      });
  }
};
