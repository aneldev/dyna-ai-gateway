import {AIGateway} from "../../..";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {AIGatewayVercelUi} from "../AIGatewayVercelUi";
import {
  makeChatRequest,
  userMessage,
} from "./utils/chatRequest";
import {
  gatewayConfigVercelUi,
  vercelUiConfigAsk,
} from "./vercel-ui.config";

/**
 * The config's `userContext` hook is the trust boundary of the endpoint (D118): what it throws before the stream starts
 * is the HTTP answer, with the error's status and its message as JSON, and the gateway is never called (nothing enqueued
 * on the fake model, nothing stored).
 */
test("chat answers a request the userContext hook refuses with the error's status, and calls nothing", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigVercelUi, {llmClient: () => llmClient});
  const ui = new AIGatewayVercelUi(vercelUiConfigAsk, {gateway});

  const response = await ui.chat({
    request: makeChatRequest({
      messages: [userMessage("Hi")],
      user: null,
    }),
  });

  expect([
    response.status,
    response.headers.get("content-type"),
    await response.json(),
    llmClient.completeCalls.length,
  ]).toEqual([
    401,
    "application/json",
    {
      code: 5377780695088,
      message: "Test endpoint: no user",
    },
    0,
  ]);
});
