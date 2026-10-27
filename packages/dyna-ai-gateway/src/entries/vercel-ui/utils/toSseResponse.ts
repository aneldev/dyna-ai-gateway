import {TGatewayUiChunk} from "../types";

/** The headers of the SDK's UI message stream protocol, version 1; what `useChat`'s default transport expects. */
const UI_MESSAGE_STREAM_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  "connection": "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
  "x-accel-buffering": "no",
};

/**
 * The SSE `Response` of a chunk stream: one `data: <json>` event per chunk, `data: [DONE]` at the end — the framing of the
 * SDK's `createUIMessageStreamResponse`, written here so the module imports no runtime from `ai`.
 * A closed connection (`cancel`) stops reading the chunks, which ends the call through the request's signal.
 */
export const toSseResponse = ({chunks}: {chunks: AsyncIterable<TGatewayUiChunk>}): Response => {
  const encoder = new TextEncoder();
  const iterator = chunks[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    pull: async (controller): Promise<void> => {
      const next = await iterator.next();
      if (next.done) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
    },
    cancel: async (): Promise<void> => {
      await iterator.return?.();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: UI_MESSAGE_STREAM_HEADERS,
  });
};
