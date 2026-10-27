import {EPartKind} from "../contracts";
import {
  IMessage,
  TMessagePart,
} from "../internal";
import {IAIGatewayDeps} from "../types";

/**
 * The messages of a paused run with the bytes of their files loaded again from the FileStore (a stored run keeps none).
 * A file deleted while the run waited becomes a text note, so the model knows it is gone; any other read error is thrown.
 */
export const restoreInlineBytes = async (
  {
    deps,
    tenantId,
    userId,
    messages,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    /** The asker of the run: the uploader of its files. */
    userId: string;
    messages: IMessage[];
  },
): Promise<IMessage[]> => Promise.all(messages.map(async (message): Promise<IMessage> => {
  if (!message.parts.some(part => part.kind === EPartKind.INLINE_FILE)) return message;
  return {
    ...message,
    parts: await Promise.all(message.parts.map(async (part): Promise<TMessagePart> => {
      if (part.kind !== EPartKind.INLINE_FILE) return part;
      try {
        return {
          ...part,
          bytes: await deps.fileStore.getBytes({
            tenantId,
            userId,
            fileId: part.fileId,
          }),
        };
      }
      catch (error) {
        if (!isNotFound(error)) throw error;
        return {
          kind: EPartKind.TEXT,
          text: `[The file ${part.name} (${part.mime}) was deleted and is no longer available]`,
        };
      }
    })),
  };
}));

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "status" in error && error.status === 404;
