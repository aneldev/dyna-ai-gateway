import {dynaError} from "dyna-error";

import {
  IUiChatRequestBody,
  TGatewayUiMessage,
} from "../types";

/**
 * The body of a `useChat` request, checked for what the module reads: JSON, a `messages` array of messages with a `role`
 * and `parts`, no regenerate (the gateway stores the turns, a regenerate would need the last answer deleted). Anything
 * else is a 400 before the gateway is called.
 */
export const parseChatRequest = async ({request}: {request: Request}): Promise<IUiChatRequestBody> => {
  let body: unknown;
  try {
    body = await request.json();
  }
  catch (error) {
    throw dynaError({
      code: 5377780695011,
      status: 400,
      message: "AIGatewayVercelUi: the request body is not JSON",
      parentError: error,
    });
  }
  if (!isRecord(body) || !Array.isArray(body.messages) || !body.messages.every(isUiMessage)) {
    throw dynaError({
      code: 5377780695022,
      status: 400,
      message: "AIGatewayVercelUi: the request body must carry `messages`, each with a `role` and `parts`",
    });
  }
  if (body.trigger === "regenerate-message") {
    throw dynaError({
      code: 5377780695033,
      status: 400,
      message: "AIGatewayVercelUi: regenerating a message is not offered; send a new message",
    });
  }
  return {
    id: typeof body.id === "string" ? body.id : "",
    messages: body.messages,
    trigger: "submit-message",
    ...typeof body.messageId === "string" ? {messageId: body.messageId} : {},
    ...typeof body.threadId === "string" && body.threadId ? {threadId: body.threadId} : {},
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isUiMessage = (value: unknown): value is TGatewayUiMessage =>
  isRecord(value)
  && typeof value.role === "string"
  && Array.isArray(value.parts)
  && value.parts.every(part => isRecord(part) && typeof part.type === "string");
