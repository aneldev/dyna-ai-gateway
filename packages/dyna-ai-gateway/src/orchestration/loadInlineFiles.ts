import {dynaError} from "dyna-error";

import {
  IFileRef,
  EPartKind,
} from "../contracts";
import {IInlineFilePart} from "../internal";
import {IAIGatewayDeps} from "../types";

/**
 * loadInlineFiles -- the bytes of the files of a question, for the model
 *
 * # About
 *
 * > The client sends pointers; the gateway loads the bytes, for the caller's own files only.
 *
 * Checks every pointer before any read: a file of another tenant or of another user is a 400 (the pointer comes from the
 * client, its `userId` is not trusted). Then reads the bytes through `FileStore.getBytes`; a file that is not there is the
 * store's 404.
 *
 * Runs in `prepareCall` before the input check and before anything is stored: the rules' judge sends the files to the
 * model, and a pointer that cannot be loaded creates nothing.
 *
 * # Who needs it
 *
 * `prepareCall`.
 */
export const loadInlineFiles = async (
  {
    deps,
    tenantId,
    userId,
    files,
  }: {
    deps: IAIGatewayDeps;
    tenantId: string;
    userId: string;
    files: IFileRef[];
  },
): Promise<IInlineFilePart[]> => {
  const foreign = files.find(file => file.tenantId !== tenantId);
  if (foreign) {
    throw dynaError({
      code: 5372799783963,
      status: 400,
      message: `AIGateway: file [${foreign.id}] is not a file of tenant [${tenantId}]`,
      data: {
        tenantId,
        fileId: foreign.id,
      },
    });
  }
  const notOwn = files.find(file => file.userId !== userId);
  if (notOwn) {
    throw dynaError({
      code: 5377210486127,
      status: 400,
      message: `AIGateway: file [${notOwn.id}] is not a file of user [${userId}]`,
      data: {fileId: notOwn.id},
    });
  }
  return Promise.all(files.map(async (file): Promise<IInlineFilePart> => ({
    kind: EPartKind.INLINE_FILE,
    mime: file.mime,
    bytes: await deps.fileStore.getBytes({
      tenantId,
      userId: file.userId,
      fileId: file.id,
    }),
    name: file.name,
    fileId: file.id,
    size: file.size,
  })));
};
