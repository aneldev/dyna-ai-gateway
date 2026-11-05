import {EPartKind} from "../contracts";
import {
  IMessage,
  TMessagePart,
} from "../internal";
import {IAIGatewayDeps} from "../types";

/**
 * restoreInlineBytes -- loads the bytes of a paused run's files again, for its resume
 *
 * # About
 *
 * > A stored run keeps no copy of an uploaded file; the resume reads the bytes from the FileStore again.
 *
 * Returns the run's messages with every INLINE_FILE part carrying its bytes. A file deleted while the run waited becomes a
 * text note, so the model knows it is gone; any other read error is thrown. Messages without a file part are returned as
 * they are.
 *
 * Runs in `continueRun` before `LLMClient.run` continues the stored messages; `settleRun` strips the bytes again when it
 * stores the run (`withoutInlineBytes`).
 *
 * # Who needs it
 *
 * `AIGateway.continueRun`.
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

/** True for an error with `status` 404: the FileStore's "no such file". */
const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "status" in error && error.status === 404;
