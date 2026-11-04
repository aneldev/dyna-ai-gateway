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
 * toSseResponse -- the SSE `Response` of a chunk stream
 *
 * # About
 *
 * > One `data: <json>` event per chunk, `data: [DONE]` at the end.
 *
 * The framing of the SDK's UI message stream protocol (v1) and its five headers, written here so the module imports
 * no runtime from `ai`. The chunks are pulled as the client reads: a closed connection (`cancel`) stops the iteration,
 * which ends the call through the request's signal (D90).
 *
 * # Who needs it
 *
 * `AIGatewayVercelUi`, for the response of `chat` and `resume`.
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
