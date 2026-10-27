import {dynaError} from "dyna-error";
import {randomUUID} from "node:crypto";

import {IFileRef} from "../../contracts";

import {
  IFileStore,
  IFileStoreConfig,
} from "./types";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
// Named one by one: "image/*" took image/svg+xml, a script that runs where the file is shown from a trusted origin
const DEFAULT_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];
const MAX_NAME_CHARS = 255;
const DEFAULT_SIGNED_URL_TTL_SEC = 900;
/** What a file id may look like. */
const FILE_ID = /^[A-Za-z0-9_-]+$/;
const SEPARATOR = "/";

/** Tenant-scoped file storage; turns reference files by IFileRef. */
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
   * Stores bytes at <tenantId>/<path>/<userId>/<fileId> and returns the pointer to put in a turn. The pointer is the only
   * record of the file: nothing else is kept.
   * Throws a 400 for an empty file, a type that is not allowed or a name over 255 characters or with control characters, a 413
   * for a file over maxBytes. The name reaches the model and the memory transcript: it is kept short and on one line.
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

  /** Loads bytes for the LLMClient (inline data part). Throws a 404 for a file that this user of this tenant does not have. */
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

  /** Short-lived URL for the UI. Throws a 404 for a file that this user of this tenant does not have. */
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
      /** Default 900. */
      ttlSec?: number;
    },
  ): Promise<string> {
    return this.config.adapter.signedUrl({
      key: this.getKey(tenantId, userId, fileId),
      ttlSec,
    });
  }

  /** Deletes the blob. A file that is not there changes nothing. */
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
   * Deletes every file a user uploaded — the user's whole folder. For a "forget this user" request (GDPR).
   * Returns the number of files deleted. The turns that pointed at them keep their pointers.
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

  /** <tenantId>/<path>/<userId>: the tenant is the first folder of every key, the user the last, so nobody can reach into another's files. */
  private getUserFolder(tenantId: string, userId: string): string {
    this.checkSegment(tenantId, "tenantId");
    this.checkSegment(userId, "userId");
    return [tenantId, this.path, userId]
      .filter(Boolean)
      .join(SEPARATOR);
  }

  /** A part of a key is one folder name: it must not be empty, contain a separator, or step out of its folder. */
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
