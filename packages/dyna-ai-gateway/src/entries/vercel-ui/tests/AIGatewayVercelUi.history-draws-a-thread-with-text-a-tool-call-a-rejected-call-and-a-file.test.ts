import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  EResumeAction,
} from "../../..";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";
import {
  getCurrentTimeTool,
  sendEmailTool,
} from "../../../tests/internal/samples/tools";
import {noKb} from "../../../tests/internal/utils/makeGateway";
import {sampleUserContext} from "../../../tests/internal/utils/sampleUserContext";

import {AIGatewayVercelUi} from "../AIGatewayVercelUi";
import {makeChatRequest} from "./utils/chatRequest";
import {
  gatewayConfigVercelUi,
  vercelUiConfigRun,
} from "./vercel-ui.config";

/**
 * The round trip of a stored thread into the messages a chat screen draws: the user's text and file, then one assistant
 * message for the whole answer (D34) with a `step-start` per model step, the executed call with its output, the call the
 * human rejected as `output-denied` with the reason, and the closing text; the metadata carries the dates and the model.
 */
test("history draws a thread with text, a tool call, a rejected call and a file as the client's messages", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigVercelUi, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const file = await gateway.uploadFile({
    userContext: sampleUserContext,
    bytes: new Uint8Array([137, 80, 78, 71]),
    mime: "image/png",
    name: "invoice.png",
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-time",
      toolName: getCurrentTimeTool.name,
      input: {},
    },
  });
  llmClient.enqueueRunStep({
    toolCall: {
      kind: EPartKind.TOOL_CALL,
      callId: "call-email",
      toolName: sendEmailTool.name,
      input: {
        to: "bob@example.com",
        subject: "Invoice",
        body: "See attached",
      },
    },
  });
  const paused = await gateway.run({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What time is it? Then email Bob the invoice.",
    files: [file],
    kbFilters: noKb,
  }).response;
  if (paused.kind !== EGatewayResponseKind.PAUSED) {
    throw dynaError({
      code: 5377780695100,
      message: `Test setup: expected PAUSED, got ${paused.kind}`,
      data: {paused},
    });
  }
  llmClient.enqueueRunStep({text: "It is noon; I did not send the email."});
  await gateway.resume({
    userContext: sampleUserContext,
    runId: paused.envelopes[0].runId,
    pauseId: paused.pauseId,
    decisions: [{
      action: EResumeAction.REJECT,
      text: "Not today",
    }],
  }).response;
  const ui = new AIGatewayVercelUi(vercelUiConfigRun, {gateway});

  const messages = await ui.history({
    request: makeChatRequest({messages: []}),
    threadId: paused.threadId,
  });

  expect(messages).toEqual([
    {
      id: expect.any(String),
      role: "user",
      metadata: {createdAt: expect.any(String)},
      parts: [
        {
          type: "text",
          text: "What time is it? Then email Bob the invoice.",
          state: "done",
        },
        {
          type: "file",
          mediaType: "image/png",
          filename: "invoice.png",
          url: `https://files.test/${file.id}`,
        },
      ],
    },
    {
      id: expect.any(String),
      role: "assistant",
      metadata: {
        createdAt: expect.any(String),
        modelId: expect.any(String),
        usage: expect.objectContaining({inputTokens: expect.any(Number)}),
      },
      parts: [
        {type: "step-start"},
        {
          type: "dynamic-tool",
          toolName: "get_current_time",
          toolCallId: "call-time",
          input: {},
          state: "output-available",
          output: expect.objectContaining({timezone: "Europe/Vienna"}),
        },
        {type: "step-start"},
        {
          type: "dynamic-tool",
          toolName: "send_email",
          toolCallId: "call-email",
          input: {
            to: "bob@example.com",
            subject: "Invoice",
            body: "See attached",
          },
          state: "output-denied",
          approval: {
            id: "call-email",
            approved: false,
            reason: expect.stringContaining("Not today"),
          },
        },
        {type: "step-start"},
        {
          type: "text",
          text: "It is noon; I did not send the email.",
          state: "done",
        },
      ],
    },
  ]);
});
