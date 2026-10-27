import {
  AIGateway,
  EPartKind,
} from "../../..";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";
import {sendEmailTool} from "../../../tests/internal/samples/tools";

import {AIGatewayVercelUi} from "../AIGatewayVercelUi";
import {
  IUiPause,
  TGatewayUiMessage,
} from "../types";
import {
  makeChatRequest,
  mergedMetadata,
  readSse,
  userMessage,
} from "./utils/chatRequest";
import {
  gatewayConfigVercelUi,
  vercelUiConfigRun,
} from "./vercel-ui.config";

/**
 * The SDK's own approval card (D35): a run that pauses for a tool streams a `tool-approval-request` whose id is the pause
 * (D110) and the pause in the metadata; the client answers with the tool part in state `approval-responded` and posts the
 * messages to the same endpoint, which resumes the run and streams the tool's output and the closing text.
 */
test("chat streams an approval request for a paused tool and resumes the run on the client's approval", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigVercelUi, {llmClient: () => llmClient});
  llmClient.accountTo({
    trace: gateway.trace,
    usageGuard: gateway.usageGuard,
  });
  const ui = new AIGatewayVercelUi(vercelUiConfigRun, {gateway});
  const emailCall = {
    kind: EPartKind.TOOL_CALL,
    callId: "call-email",
    toolName: sendEmailTool.name,
    input: {
      to: "bob@example.com",
      subject: "Hi",
      body: "Hello Bob",
    },
  } as const;
  llmClient.enqueueRunStep({toolCall: emailCall});

  const paused = await readSse({response: await ui.chat({request: makeChatRequest({messages: [userMessage("Email Bob")]})})});
  const pausedMetadata = mergedMetadata({chunks: paused.chunks});
  const pause = pausedMetadata.pause as IUiPause;
  const approvalRequest = paused.chunks.find(chunk => chunk.type === "tool-approval-request");

  const approved: TGatewayUiMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: emailCall.toolName,
      toolCallId: emailCall.callId,
      input: emailCall.input,
      state: "approval-responded",
      approval: {
        id: approvalRequest?.type === "tool-approval-request" ? approvalRequest.approvalId : "",
        approved: true,
      },
    }],
  };
  llmClient.enqueueRunStep({text: "Sent."});
  const resumed = await readSse({
    response: await ui.chat({
      request: makeChatRequest({
        messages: [userMessage("Email Bob"), approved],
        threadId: String(pausedMetadata.threadId),
      }),
    }),
  });
  const stillPaused = await gateway.listPausedRuns({userContext: await vercelUiConfigRun.userContext({request: makeChatRequest({messages: []})})});

  expect([
    paused.chunks.map(chunk => chunk.type),
    approvalRequest,
    pause.kind,
    pause.envelopes.map(envelope => envelope.pauseId === pause.pauseId),
    resumed.chunks.map(chunk => chunk.type),
    resumed.chunks.find(chunk => chunk.type === "tool-output-available"),
    resumed.chunks.flatMap(chunk => chunk.type === "text-delta" ? [chunk.delta] : []).join(""),
    stillPaused,
  ]).toEqual([
    ["start", "start-step", "tool-input-available", "tool-approval-request", "message-metadata", "finish-step", "finish"],
    {
      type: "tool-approval-request",
      approvalId: pause.pauseId,
      toolCallId: "call-email",
    },
    "TOOL_APPROVAL",
    [true],
    // The resumed step sends no STEP_END after the decided call: its output and the closing text share one step
    ["start", "start-step", "tool-output-available", "text-start", "text-delta", "text-end", "finish-step", "message-metadata", "finish"],
    {
      type: "tool-output-available",
      toolCallId: "call-email",
      output: expect.objectContaining({
        sent: true,
        to: "bob@example.com",
      }),
      dynamic: true,
    },
    "Sent.",
    [],
  ]);
});
