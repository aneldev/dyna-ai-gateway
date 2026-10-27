import {sampleUserContext} from "../../../../tests/internal/utils/sampleUserContext";

import {
  TGatewayUiChunk,
  TGatewayUiMessage,
} from "../../types";
import {USER_HEADER} from "../vercel-ui.config";

/** A `POST` as `useChat`'s default transport sends it; `user` names the caller for the test's `userContext` hook. */
export const makeChatRequest = (
  {
    messages,
    threadId,
    user = sampleUserContext.userId,
  }: {
    messages: TGatewayUiMessage[];
    threadId?: string;
    user?: string | null;
  },
): Request => new Request("https://app.test/api/chat", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...user === null ? {} : {[USER_HEADER]: user},
  },
  body: JSON.stringify({
    id: "chat-1",
    trigger: "submit-message",
    messages,
    ...threadId ? {threadId} : {},
  }),
});

/** The user's text message as the client builds it. */
export const userMessage = (text: string): TGatewayUiMessage => ({
  id: `user-${text.length}`,
  role: "user",
  parts: [{
    type: "text",
    text,
  }],
});

/** The chunks of an SSE response, and whether it ended with `[DONE]`. */
export const readSse = async ({response}: {response: Response}): Promise<{chunks: TGatewayUiChunk[]; done: boolean}> => {
  const text = await response.text();
  const events = text.split("\n\n")
    .filter(Boolean)
    .map(line => line.replace(/^data: /, ""));
  return {
    chunks: events.filter(event => event !== "[DONE]").map((event): TGatewayUiChunk => JSON.parse(event)),
    done: events[events.length - 1] === "[DONE]",
  };
};

/** The one metadata object the chunks build up, as the client merges it. */
export const mergedMetadata = ({chunks}: {chunks: TGatewayUiChunk[]}): Record<string, unknown> =>
  chunks.reduce<Record<string, unknown>>((metadata, chunk) => {
    if ((chunk.type === "start" || chunk.type === "finish" || chunk.type === "message-metadata") && chunk.messageMetadata) {
      return {
        ...metadata,
        ...chunk.messageMetadata,
      };
    }
    return metadata;
  }, {});
