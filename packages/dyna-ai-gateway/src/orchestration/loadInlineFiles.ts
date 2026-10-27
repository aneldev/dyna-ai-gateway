import {dynaError} from "dyna-error";

import {
  IFileRef,
  EPartKind,
} from "../contracts";
import {IInlineFilePart} from "../internal";
import {IAIGatewayDeps} from "../types";

/**
 * The bytes of the files of a question, for the model. Throws a 400 for a pointer of another tenant or of another user
 * (the pointer comes from the client, its `userId` is not trusted) and the FileStore's 404 for a file that is not there.
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
