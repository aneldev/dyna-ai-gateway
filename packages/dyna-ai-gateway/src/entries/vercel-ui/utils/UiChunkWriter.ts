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
 * UiChunkWriter -- the chunk protocol's order on top of the gateway's events
 *
 * # About
 *
 * > A state machine with two bits: is a step open, is a text open.
 *
 * The implementation of `IUiChunkWriter`: opens `start-step` and `text-start` with the first chunk that needs them,
 * closes them before a tool, a step end or the end, so every chunk lands in the order the client's reducer expects.
 * Pure: no gateway, no I/O.
 *
 * Sits between the call's `events` and `response` and the SSE framing (`toSseResponse`).
 *
 * # Who needs it
 *
 * `UiMapper.createChunkWriter` builds it, one per call; `AIGatewayVercelUi` drives it, or an application on its own
 * transport.
 *
 * # Pitfalls
 *
 * One writer per call, the events in order: a writer shared or fed out of order misplaces `text-end` and `finish-step`.
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

  /**
   * start -- the chunks that open the stream
   *
   * # About
   *
   * > One `start` chunk: the message id, the date, the thread when it exists.
   *
   * Called once, before the first event. A new thread's id is not known yet: it reaches the client with the response's
   * metadata.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, first thing; an application streaming on its own transport.
   */
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

  /**
   * onEvent -- the chunks of one event of the running call
   *
   * # About
   *
   * > Zero or more chunks, in the order the client's reducer expects.
   *
   * A text delta opens its step and its text when they are not open; a tool request closes the text first; a step end
   * closes both. `RUN_ENDED_BY_TOOL` and `ANSWER_WITHDRAWN` land as `message-metadata`; the other events add nothing,
   * the response carries the result.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, once per event of `IGatewayCall.events` (D38).
   *
   * # Pitfalls
   *
   * Events in order, one writer per call: the writer keeps the open text and the open step between the calls.
   */
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

  /**
   * onResponse -- the chunks that close the stream with the call's response
   *
   * # About
   *
   * > ANSWER, PAUSED or FAILED: the results as metadata, then `finish`.
   *
   * ANSWER: `message-metadata` with the thread, usage, citations, issues, `structured` and `endedByTool`, then `finish`.
   * PAUSED: a `tool-approval-request` per TOOL_APPROVAL envelope, the pause as metadata, `finish`. FAILED: an `error`
   * chunk with the reason and a `finish` whose metadata carries the thread and the issues. The open text and step are
   * closed first.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, after the last event, with the awaited `IGatewayCall.response`.
   */
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

  /**
   * onError -- the chunks that close the stream after a thrown error
   *
   * # About
   *
   * > `error` with the public reason, then `finish`; the open text and step closed first.
   *
   * # Who needs it
   *
   * `streamChunks` of `AIGatewayVercelUi`, when the events or the response throw once the stream runs
   * (`toPublicError` gives the reason: a 5xx never carries its message).
   */
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

  /**
   * The closing of a PAUSED response: an approval request per TOOL_APPROVAL envelope, the pause as metadata, `finish`.
   * `finishReason` is `tool-calls` for a pause on a tool, `stop` for a RESULT_REVIEW.
   */
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

  /** `start-step` once per step; nothing while a step is open. */
  private openStep(): TGatewayUiChunk[] {
    if (this.stepOpen) return [];
    this.stepOpen = true;
    return [{type: "start-step"}];
  }

  /** `finish-step` when a step is open; nothing otherwise. */
  private closeStep(): TGatewayUiChunk[] {
    if (!this.stepOpen) return [];
    this.stepOpen = false;
    return [{type: "finish-step"}];
  }

  /** `text-start` with a fresh id (`text-<n>`) when no text is open; nothing otherwise. */
  private openText(): TGatewayUiChunk[] {
    if (this.textId !== undefined) return [];
    this.textCount += 1;
    this.textId = `text-${this.textCount}`;
    return [{
      type: "text-start",
      id: this.textId,
    }];
  }

  /** `text-end` of the open text, which is then closed; nothing when none is open. */
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

/** A `message-metadata` chunk; the client merges it into the message's metadata. */
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
