import {dynaError} from "dyna-error";
import {randomUUID} from "node:crypto";

import {IFileRef} from "../../contracts";

import {
  IFileStore,
  IFileStoreConfig,
} from "./types";

/** The upload cap when the config names no `maxBytes`: 20 MB. */
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
/** The types allowed when the config names no `allowedMime`. Named one by one: "image/*" took image/svg+xml, a script that runs where the file is shown. */
const DEFAULT_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
/** The longest file name stored; it reaches the model and the transcript. */
const MAX_NAME_CHARS = 255;
/** The life of a signed URL when the caller names no `ttlSec`. */
const DEFAULT_SIGNED_URL_TTL_SEC = 900;
/** What a file id may look like. */
const FILE_ID = /^[A-Za-z0-9_-]+$/;
/** The folder separator of a blob key. */
const SEPARATOR = "/";

/**
 * FileStore -- the uploaded files: bytes in blob storage, pointers in the turns
 *
 * # About
 *
 * > The thread database stays small; the model gets the bytes only when it can read them.
 *
 * Stores the files a user uploads for a question (images, PDFs) in the host's blob storage, at
 * `<tenantId>/<path>/<userId>/<fileId>`, and hands back an `IFileRef` pointer that the turn keeps. The call path loads the
 * bytes again for the model (`loadInlineFiles`, `restoreInlineBytes`); the pointer is the only record of the file.
 *
 * - Tenant- and user-scoped by the key: the tenant is the first folder, the user the last, so nobody reaches another's files.
 * - Capped at the upload: the size (`maxBytes`), the type (`allowedMime`), the name (255 characters, one line).
 * - Deleted with the thread (`deleteThreads`) and with the user (`forgetUser`): the user's whole folder in one call.
 *
 * Created by `createGatewayDeps` with no deps; written by `AIGateway.uploadFile`, read inside `prepareCall` and `continueRun`.
 *
 * # Who needs it
 *
 * `AIGateway.uploadFile`, `deleteFile`, `removeFilesByUser`; `loadInlineFiles`, `restoreInlineBytes`, `deleteThreads`, `forgetUser`.
 *
 * # What needs
 *
 * `IFileStoreConfig`: the `IBlobAdapter`, the `path` (required, may be empty), the optional caps.
 *
 * # Usage
 *
 * ## When to use it
 *
 * A file the user attaches to a question, so the model can read it.
 *
 * ## When shouldn't use it
 *
 * Documents the model should search: that is the knowledge base (`KbIngestor`).
 *
 * # Pitfalls
 *
 * `path` and every id are checked as folder names (no separator, no "." or ".."): a bad one is a 400 before the adapter is
 * reached. The default types exclude SVG on purpose. `getSignedUrl` has no facade method: a host that needs it builds a
 * `FileStore` on the same adapter and config.
 */
export class FileStore implements IFileStore {
  /** The folders of config.path joined by single slashes, none at the ends; "" when the config names no folder. */
  private readonly path: string;

  constructor(private readonly config: IFileStoreConfig) {
    const folders = config.path
      .split(SEPARATOR)
      .filter(Boolean);
    folders.forEach(folder => this.checkSegment(folder, "path"));
    this.path = folders.join(SEPARATOR);
  }

  /**
   * put -- stores an upload and returns its pointer
   *
   * # About
   *
   * > Bytes at `<tenantId>/<path>/<userId>/<fileId>`, an `IFileRef` for the turn; nothing else is kept.
   *
   * Checks before the write: the type must be allowed (400), the name at most 255 characters without control characters
   * (400; it reaches the model and the memory transcript, so it stays short and on one line), the file not empty (400) and
   * not over `maxBytes` (413). The id is a new UUID.
   *
   * # Who needs it
   *
   * `AIGateway.uploadFile`, as a call of the uploading user.
   */
  public async put(
    {
      tenantId,
      userId,
      bytes,
      mime,
      name,
    }: {
      tenantId: string;
      /** Who uploads; the file is stored in this user's folder. */
      userId: string;
      bytes: Uint8Array;
      mime: string;
      name: string;
    },
  ): Promise<IFileRef> {
    const allowedMime = this.config.allowedMime ?? DEFAULT_ALLOWED_MIME;
    if (!allowedMime.some(allowed => this.matchesMime(mime, allowed))) {
      throw dynaError({
        code: 5372795409348,
        status: 400,
        message: `FileStore: files of type [${mime}] are not allowed; allowed: ${allowedMime.join(", ")}`,
        data: {
          mime,
          allowedMime,
        },
      });
    }
    if (name.length > MAX_NAME_CHARS || hasControlCharacter(name)) {
      throw dynaError({
        code: 5377210486171,
        status: 400,
        message: `FileStore: a file name must be at most ${MAX_NAME_CHARS} characters, without control characters`,
        data: {
          length: name.length,
          maxChars: MAX_NAME_CHARS,
        },
      });
    }
    const maxBytes = this.config.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!bytes.length || bytes.length > maxBytes) {
      throw dynaError({
        code: 5372795409561,
        status: bytes.length ? 413 : 400,
        message: bytes.length
          ? `FileStore: the file has ${bytes.length} bytes, the limit is ${maxBytes}`
          : "FileStore: the file is empty",
        data: {
          size: bytes.length,
          maxBytes,
        },
      });
    }

    const id = randomUUID();
    await this.config.adapter.put({
      key: this.getKey(tenantId, userId, id),
      bytes,
      mime,
    });
    return {
      id,
      tenantId,
      userId,
      mime,
      size: bytes.length,
      name,
    };
  }

  /**
   * getBytes -- the bytes of a file, for the model
   *
   * # About
   *
   * > The inline part of a message: the pointer back into bytes.
   *
   * Reads the blob at the user's key; a file this user of this tenant does not have is the adapter's 404.
   *
   * # Who needs it
   *
   * `loadInlineFiles` (the files of a question) and `restoreInlineBytes` (the files of a paused run on its resume).
   */
  public async getBytes(
    {
      tenantId,
      userId,
      fileId,
    }: {
      tenantId: string;
      /** The user who uploaded the file (IFileRef.userId). */
      userId: string;
      fileId: string;
    },
  ): Promise<Uint8Array> {
    return this.config.adapter.get({key: this.getKey(tenantId, userId, fileId)});
  }

  /**
   * getSignedUrl -- a short-lived URL of a file, for a screen
   *
   * # About
   *
   * > The bytes without passing through the server: the adapter signs, the browser fetches.
   *
   * A file this user of this tenant does not have is the adapter's 404. No facade method calls it: a host that shows the
   * files builds a `FileStore` on the same adapter and config.
   *
   * # Who needs it
   *
   * The host's chat screen, to show an uploaded image or open a PDF.
   */
  public async getSignedUrl(
    {
      tenantId,
      userId,
      fileId,
      ttlSec = DEFAULT_SIGNED_URL_TTL_SEC,
    }: {
      tenantId: string;
      /** The user who uploaded the file (IFileRef.userId). */
      userId: string;
      fileId: string;
      /**
       * How long the URL stays valid, in seconds.
       *
       * @default 900
       */
      ttlSec?: number;
    },
  ): Promise<string> {
    return this.config.adapter.signedUrl({
      key: this.getKey(tenantId, userId, fileId),
      ttlSec,
    });
  }

  /**
   * remove -- deletes one file
   *
   * # About
   *
   * > The blob goes; the turn that pointed at it keeps the pointer.
   *
   * A file that is not there changes nothing.
   *
   * # Who needs it
   *
   * `AIGateway.deleteFile`; `deleteThreads`, for every file the deleted turns pointed at.
   */
  public async remove(
    {
      tenantId,
      userId,
      fileId,
    }: {
      tenantId: string;
      /** The user who uploaded the file (IFileRef.userId). */
      userId: string;
      fileId: string;
    },
  ): Promise<void> {
    await this.config.adapter.remove({key: this.getKey(tenantId, userId, fileId)});
  }

  /**
   * removeFilesByUser -- deletes every file a user uploaded
   *
   * # About
   *
   * > The user's whole folder in one adapter call, for "forget this user" (D54).
   *
   * Returns the number of files deleted. The turns that pointed at them keep their pointers.
   *
   * # Who needs it
   *
   * `forgetUser` (both modes) and `AIGateway.removeFilesByUser`.
   */
  public async removeFilesByUser(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<number> {
    return this.config.adapter.removeByPrefix({prefix: this.getUserFolder(tenantId, userId) + SEPARATOR});
  }

  /** The blob key of a file: the user's folder plus the id; an id outside `FILE_ID` is a 400. */
  private getKey(tenantId: string, userId: string, fileId: string): string {
    if (!FILE_ID.test(fileId)) {
      throw dynaError({
        code: 5372795409759,
        status: 400,
        message: "FileStore: this is not a file id",
        data: {fileId},
      });
    }
    return this.getUserFolder(tenantId, userId) + SEPARATOR + fileId;
  }

  /**
   * <tenantId>/<path>/<userId>: the tenant is the first folder of every key, the user the last.
   * Nobody can reach into another's files; both ids are checked as folder names.
   */
  private getUserFolder(tenantId: string, userId: string): string {
    this.checkSegment(tenantId, "tenantId");
    this.checkSegment(userId, "userId");
    return [tenantId, this.path, userId]
      .filter(Boolean)
      .join(SEPARATOR);
  }

  /**
   * A part of a key is one folder name.
   * It must not be empty, contain a separator, or step out of its folder ("." / ".."): a 400 otherwise.
   */
  private checkSegment(segment: string, name: string): void {
    if (segment && segment !== "." && segment !== ".." && !/[\\/]/.test(segment)) return;
    throw dynaError({
      code: 5372797101150,
      status: 400,
      message: `FileStore: [${segment}] cannot be used as ${name} in the path of a file`,
      data: {[name]: segment},
    });
  }

  /** "image/*" allows every image type; anything else must be equal. */
  private matchesMime(mime: string, allowed: string): boolean {
    return allowed.endsWith("/*")
      ? mime.startsWith(allowed.slice(0, -1))
      : mime === allowed;
  }
}

/** A line break, a tab or another C0 control character, or DEL. */
const hasControlCharacter = (text: string): boolean => [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
