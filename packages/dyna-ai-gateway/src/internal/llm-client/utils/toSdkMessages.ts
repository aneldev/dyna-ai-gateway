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

const toToolMessage = (message: IMessage): ToolModelMessage => ({
  role: "tool",
  content: message.parts.flatMap(part => part.kind === EPartKind.TOOL_RESULT ? [toToolOutput(part)] : []),
});

const CONVERTERS: Record<EMessageRole, (message: IMessage) => ModelMessage> = {
  [EMessageRole.USER]: toUserMessage,
  [EMessageRole.ASSISTANT]: toAssistantMessage,
  [EMessageRole.TOOL]: toToolMessage,
};

/** Our provider-agnostic messages → the SDK's messages. Parts a role cannot carry are dropped. */
export const toSdkMessages = (messages: IMessage[]): ModelMessage[] =>
  messages.map(message => CONVERTERS[message.role](message));
