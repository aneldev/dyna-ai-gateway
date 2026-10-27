import {
  EGatewayResponseKind,
  ELLMClientEventKind,
  EPauseKind,
  ILLMClientEvent,
  IPausedResponse,
  TGatewayResponse,
} from "../../..";

import {
  IUiChunkWriter,
  IUiMessageMetadata,
  TGatewayUiChunk,
} from "../types";

import {toUiPause} from "./toUiPause";

/**
 * The state machine behind `IUiChunkWriter`: keeps the open text and the open step, so every chunk lands in the order
 * the client's reducer expects. See the interface for the contract; `UiMapper.createChunkWriter` builds it.
 */
export class UiChunkWriter implements IUiChunkWriter {
  private textId: string | undefined;
  private textCount = 0;
  private stepOpen = false;

  constructor(
    private readonly args: {
      messageId: string;
      threadId?: string;
    },
  ) {
  }

  public start(): TGatewayUiChunk[] {
    return [{
      type: "start",
      messageId: this.args.messageId,
      messageMetadata: {
        createdAt: new Date().toISOString(),
        ...this.args.threadId ? {threadId: this.args.threadId} : {},
      },
    }];
  }

  public onEvent({event}: {event: ILLMClientEvent}): TGatewayUiChunk[] {
    switch (event.kind) {
      case ELLMClientEventKind.TEXT_DELTA:
        return [
          ...this.openStep(),
          ...this.openText(),
          {
            type: "text-delta",
            id: this.textId ?? "",
            delta: event.text ?? "",
          },
        ];
      case ELLMClientEventKind.TOOL_REQUEST:
        if (!event.toolCall) return [];
        return [
          ...this.openStep(),
          ...this.closeText(),
          {
            type: "tool-input-available",
            toolCallId: event.toolCall.callId,
            toolName: event.toolCall.toolName,
            input: event.toolCall.input,
            dynamic: true,
          },
        ];
      case ELLMClientEventKind.TOOL_RESULT:
        if (!event.toolCall) return [];
        return [
          ...this.openStep(),
          errorTextOf(event.toolOutput) === undefined
            ? {
              type: "tool-output-available",
              toolCallId: event.toolCall.callId,
              output: event.toolOutput,
              dynamic: true,
            }
            : {
              type: "tool-output-error",
              toolCallId: event.toolCall.callId,
              errorText: errorTextOf(event.toolOutput) ?? "",
              dynamic: true,
            },
        ];
      case ELLMClientEventKind.STEP_END:
        return [
          ...this.closeText(),
          ...this.closeStep(),
        ];
      case ELLMClientEventKind.RUN_ENDED_BY_TOOL:
        return event.toolCall ? [metadata({endedByTool: event.toolCall.toolName})] : [];
      case ELLMClientEventKind.ANSWER_WITHDRAWN:
        return [
          ...this.closeText(),
          metadata({
            withdrawn: true,
            issues: event.issues ?? [],
          }),
        ];
      default:
        return [];
    }
  }

  public onResponse({response}: {response: TGatewayResponse}): TGatewayUiChunk[] {
    switch (response.kind) {
      case EGatewayResponseKind.ANSWER:
        return [
          ...this.closeText(),
          metadata({
            threadId: response.threadId,
            usage: response.usage,
            citations: response.citations,
            issues: response.issues,
            ...response.structured === undefined ? {} : {structured: response.structured},
            ...response.endedByTool ? {endedByTool: response.endedByTool} : {},
          }),
          ...this.closeStep(),
          {
            type: "finish",
            finishReason: "stop",
          },
        ];
      case EGatewayResponseKind.PAUSED:
        return this.onPaused(response);
      case EGatewayResponseKind.FAILED:
        return [
          ...this.closeText(),
          ...this.closeStep(),
          {
            type: "error",
            errorText: response.reason,
          },
          {
            type: "finish",
            finishReason: "error",
            messageMetadata: {
              ...response.threadId ? {threadId: response.threadId} : {},
              issues: response.issues,
            },
          },
        ];
    }
  }

  public onError({reason}: {reason: string}): TGatewayUiChunk[] {
    return [
      ...this.closeText(),
      ...this.closeStep(),
      {
        type: "error",
        errorText: reason,
      },
      {
        type: "finish",
        finishReason: "error",
      },
    ];
  }

  private onPaused(response: IPausedResponse): TGatewayUiChunk[] {
    const pause = toUiPause(response);
    const approvalRequests: TGatewayUiChunk[] =
      response.envelopes.flatMap((envelope): TGatewayUiChunk[] =>
        envelope.kind === EPauseKind.TOOL_APPROVAL
          ? [{
            type: "tool-approval-request",
            approvalId: envelope.pauseId,
            toolCallId: envelope.callId,
            ...envelope.reasonCode ? {reason: envelope.reasonCode} : {},
          }]
          : []);
    return [
      ...this.closeText(),
      ...approvalRequests.length ? this.openStep() : [],
      ...approvalRequests,
      metadata({
        threadId: response.threadId,
        pause,
      }),
      ...this.closeStep(),
      {
        type: "finish",
        finishReason: pause.kind === EPauseKind.RESULT_REVIEW ? "stop" : "tool-calls",
      },
    ];
  }

  private openStep(): TGatewayUiChunk[] {
    if (this.stepOpen) return [];
    this.stepOpen = true;
    return [{type: "start-step"}];
  }

  private closeStep(): TGatewayUiChunk[] {
    if (!this.stepOpen) return [];
    this.stepOpen = false;
    return [{type: "finish-step"}];
  }

  private openText(): TGatewayUiChunk[] {
    if (this.textId !== undefined) return [];
    this.textCount += 1;
    this.textId = `text-${this.textCount}`;
    return [{
      type: "text-start",
      id: this.textId,
    }];
  }

  private closeText(): TGatewayUiChunk[] {
    if (this.textId === undefined) return [];
    const id = this.textId;
    this.textId = undefined;
    return [{
      type: "text-end",
      id,
    }];
  }
}

const metadata = (messageMetadata: IUiMessageMetadata): TGatewayUiChunk => ({
  type: "message-metadata",
  messageMetadata,
});

/** The `error` of a failed tool's output (`{error}`, D76); undefined for every other output. */
const errorTextOf = (output: unknown): string | undefined => {
  if (typeof output !== "object" || output === null || !("error" in output)) return undefined;
  const {error} = output as {error: unknown};
  return typeof error === "string" ? error : JSON.stringify(error);
};
