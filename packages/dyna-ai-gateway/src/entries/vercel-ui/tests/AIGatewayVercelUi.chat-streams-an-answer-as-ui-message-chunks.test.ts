import {AIGateway} from "../../..";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";
import {openAiModel} from "../../../tests/internal/samples/models";
import {makeModelResult} from "../../../tests/internal/utils/makeGateway";

import {AIGatewayVercelUi} from "../AIGatewayVercelUi";
import {
  makeChatRequest,
  mergedMetadata,
  readSse,
  userMessage,
} from "./utils/chatRequest";
import {
  gatewayConfigVercelUi,
  vercelUiConfigAsk,
} from "./vercel-ui.config";

/**
 * The `useChat` endpoint on an `ask` use case: the last user message becomes the prompt, the answer streams as the SDK's
 * UI message chunks in the order its reducer expects (start, step, text open / delta / close, the metadata of the call,
 * finish), framed as the v1 SSE protocol, and the metadata names the thread the gateway created.
 */
test("chat streams an answer as UI message chunks on a new thread and names the thread in the metadata", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigVercelUi, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "Hello there",
  }));
  const ui = new AIGatewayVercelUi(vercelUiConfigAsk, {gateway});

  const response = await ui.chat({request: makeChatRequest({messages: [userMessage("Hi")]})});
  const {
    chunks,
    done,
  } = await readSse({response});
  const threads = await gateway.listThreads({
    userContext: (await vercelUiConfigAsk.userContext({request: makeChatRequest({messages: []})})),
    page: {
      limit: 10,
      startingAfter: null,
      endingBefore: null,
    },
  });

  expect([
    response.status,
    response.headers.get("content-type"),
    response.headers.get("x-vercel-ai-ui-message-stream"),
    chunks.map(chunk => chunk.type),
    chunks.flatMap(chunk => chunk.type === "text-delta" ? [chunk.delta] : []).join(""),
    mergedMetadata({chunks}).threadId,
    done,
  ]).toEqual([
    200,
    "text/event-stream",
    "v1",
    ["start", "start-step", "text-start", "text-delta", "text-end", "message-metadata", "finish-step", "finish"],
    "Hello there",
    threads.items[0]?.id,
    true,
  ]);
});
