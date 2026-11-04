import {
  AssistantModelMessage,
  JSONValue,
  ModelMessage,
  ToolModelMessage,
  UserModelMessage,
} from "ai";

import {
  DEFAULT_TOOL_REJECTION_TEXT,
  IToolResultPart,
  EPartKind,
} from "../../../contracts";

import {
  IMessage,
  EMessageRole,
} from "../types";

/** A USER message: text and inline files; the other kinds are dropped. */
const toUserMessage = (message: IMessage): UserModelMessage => ({
  role: "user",
  content: message.parts.flatMap((part): UserModelMessage["content"] extends string | infer TParts ? TParts : never => {
    switch (part.kind) {
      case EPartKind.TEXT:
        return [{
          type: "text",
          text: part.text,
        }];
      case EPartKind.INLINE_FILE:
        return [{
          type: "file",
          data: part.bytes,
          mediaType: part.mime,
          filename: part.name,
        }];
      default:
        return [];
    }
  }),
});

/** An ASSISTANT message: text and tool calls; the other kinds are dropped. */
const toAssistantMessage = (message: IMessage): AssistantModelMessage => ({
  role: "assistant",
  content: message.parts.flatMap((part): AssistantModelMessage["content"] extends string | infer TParts ? TParts : never => {
    switch (part.kind) {
      case EPartKind.TEXT:
        return [{
          type: "text",
          text: part.text,
        }];
      case EPartKind.TOOL_CALL:
        return [{
          type: "tool-call",
          toolCallId: part.callId,
          toolName: part.toolName,
          input: part.input,
        }];
      default:
        return [];
    }
  }),
});

/**
 * A human's rejection and a policy's denial (D87) travel as the SDK's `execution-denied` output; everything else as JSON.
 * The part holds the full text the model reads (the loop and `closeRun` compose it); a part without one gets the default
 * rejection text, so an empty result never reads as "ran, returned nothing".
 */
const toToolOutput = (part: IToolResultPart): ToolModelMessage["content"][number] => ({
  type: "tool-result",
  toolCallId: part.callId,
  toolName: part.toolName,
  output: part.rejected || part.denied
    ? {
      type: "execution-denied",
      reason: typeof part.output === "string" && part.output.trim() ? part.output : DEFAULT_TOOL_REJECTION_TEXT,
    }
    : {
      type: "json",
      value: (part.output ?? null) as JSONValue,
    },
});

/** A TOOL message: its tool results, through `toToolOutput`. */
const toToolMessage = (message: IMessage): ToolModelMessage => ({
  role: "tool",
  content: message.parts.flatMap(part => part.kind === EPartKind.TOOL_RESULT ? [toToolOutput(part)] : []),
});

const CONVERTERS: Record<EMessageRole, (message: IMessage) => ModelMessage> = {
  [EMessageRole.USER]: toUserMessage,
  [EMessageRole.ASSISTANT]: toAssistantMessage,
  [EMessageRole.TOOL]: toToolMessage,
};

/**
 * toSdkMessages -- our messages in the SDK's shape
 *
 * # About
 *
 * > One converter per role; a part the role cannot carry is dropped.
 *
 * USER keeps text and inline files (bytes, media type, name), ASSISTANT text and tool calls, TOOL the results: a human's
 * rejection and a policy's denial travel as the SDK's `execution-denied` output with the text the model reads, everything
 * else as JSON (D87).
 *
 * # Who needs it
 *
 * `LLMClient.complete`, for the `messages` of every call.
 */
export const toSdkMessages = (messages: IMessage[]): ModelMessage[] =>
  messages.map(message => CONVERTERS[message.role](message));
