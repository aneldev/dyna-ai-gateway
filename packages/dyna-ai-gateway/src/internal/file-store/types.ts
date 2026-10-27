import {IFileRef} from "../../contracts";

/** Configuration of the FileStore. Lands in IAIGatewayConfig.fileStore. */
export interface IFileStoreConfig {
  /** Blob backend; S3-compatible or the platform's storage service. */
  adapter: IBlobAdapter;
  /**
   * The folder, inside a tenant's folder, that the files of the gateway are stored under — like a file-system path with any
   * number of folders: "apps/crm/ai-files". A file is stored at <tenantId>/<path>/<userId>/<fileId>.
   * No default: where the files live is decided where the gateway is configured. It may be an empty string (the files
   * are then at <tenantId>/<userId>/<fileId>) and may begin or end with "/": the key never gets a doubled "//".
   */
  path: string;
  /** Reject larger uploads. Default 20 MB. */
  maxBytes?: number;
  /**
   * Allowed MIME types; `x/*` allows every subtype. Default: image/png, image/jpeg, image/webp, image/gif, application/pdf.
   * `image/*` also allows `image/svg+xml`, which can carry a script: allow it only when the files are never shown inline from
   * an origin the app trusts.
   */
  allowedMime?: string[];
}

/**
 * Tenant-scoped file storage; turns reference files by IFileRef.
 *
 * Implemented by `FileStore`; the type of `IAIGatewayDeps.fileStore`, so a host may pass its own in `overrides`.
 */
export interface IFileStore {
  /**
   * Stores bytes at <tenantId>/<path>/<userId>/<fileId> and returns the pointer to put in a turn. The pointer is the only
   * record of the file: nothing else is kept.
   * Throws a 400 for an empty file, a type that is not allowed or a name over 255 characters or with control characters, a 413
   * for a file over maxBytes. The name reaches the model and the memory transcript: it is kept short and on one line.
   */
  put(args: {
    tenantId: string;
    /** Who uploads; the file is stored in this user's folder. */
    userId: string;
    bytes: Uint8Array;
    mime: string;
    name: string;
  }): Promise<IFileRef>;

  /** Loads bytes for the LLMClient (inline data part). Throws a 404 for a file that this user of this tenant does not have. */
  getBytes(args: {
    tenantId: string;
    /** The user who uploaded the file (IFileRef.userId). */
    userId: string;
    fileId: string;
  }): Promise<Uint8Array>;

  /** Short-lived URL for the UI. Throws a 404 for a file that this user of this tenant does not have. */
  getSignedUrl(args: {
    tenantId: string;
    /** The user who uploaded the file (IFileRef.userId). */
    userId: string;
    fileId: string;
    /** Default 900. */
    ttlSec?: number;
  }): Promise<string>;

  /** Deletes the blob. A file that is not there changes nothing. */
  remove(args: {
    tenantId: string;
    /** The user who uploaded the file (IFileRef.userId). */
    userId: string;
    fileId: string;
  }): Promise<void>;

  /**
   * Deletes every file a user uploaded — the user's whole folder. For a "forget this user" request (GDPR).
   * Returns the number of files deleted. The turns that pointed at them keep their pointers.
   */
  removeFilesByUser(args: {
    tenantId: string;
    userId: string;
  }): Promise<number>;
}

/** Blob storage seam. */
export interface IBlobAdapter {
  put(args: {
    key: string;
    bytes: Uint8Array;
    mime: string;
  }): Promise<void>;
  /** Throws a 404 for a key that does not exist. */
  get(args: {key: string}): Promise<Uint8Array>;
  /** Throws a 404 for a key that does not exist. */
  signedUrl(args: {
    key: string;
    ttlSec: number;
  }): Promise<string>;
  remove(args: {key: string}): Promise<void>;
  /** Removes every blob whose key starts with the prefix (a folder, ending with "/"). Returns the number removed. */
  removeByPrefix(args: {prefix: string}): Promise<number>;
}
