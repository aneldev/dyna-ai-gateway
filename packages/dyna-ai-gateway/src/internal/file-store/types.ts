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
  /**
   * The largest upload accepted, in bytes; a larger file is a 413.
   *
   * > Size it for what the models take: a PDF of many pages, a photo from a phone.
   *
   * @example 5 * 1024 * 1024 - a chat that takes screenshots only
   *
   * @default 20 * 1024 * 1024 (20 MB)
   */
  maxBytes?: number;
  /**
   * Allowed MIME types; `x/*` allows every subtype.
   *
   * > What the models can read, and nothing that runs where it is shown.
   *
   * `image/*` also allows `image/svg+xml`, which can carry a script: allow it only when the files are never shown inline from
   * an origin the app trusts.
   *
   * @example ["application/pdf"] - a document assistant that takes no images
   *
   * @default ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]
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
  put(args: {
    tenantId: string;
    /** Who uploads; the file is stored in this user's folder. */
    userId: string;
    bytes: Uint8Array;
    mime: string;
    name: string;
  }): Promise<IFileRef>;

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
  getBytes(args: {
    tenantId: string;
    /** The user who uploaded the file (IFileRef.userId). */
    userId: string;
    fileId: string;
  }): Promise<Uint8Array>;

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
  getSignedUrl(args: {
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
  }): Promise<string>;

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
  remove(args: {
    tenantId: string;
    /** The user who uploaded the file (IFileRef.userId). */
    userId: string;
    fileId: string;
  }): Promise<void>;

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
  removeFilesByUser(args: {
    tenantId: string;
    userId: string;
  }): Promise<number>;
}

/** Blob storage seam. */
export interface IBlobAdapter {
  /**
   * put -- stores the bytes under a key
   *
   * # About
   *
   * > Replace what was there; keep the media type with the bytes.
   *
   * The `mime` is stored with the bytes so the signed URL can serve them with the right type.
   *
   * # Who needs it
   *
   * `FileStore.put`.
   */
  put(args: {
    key: string;
    bytes: Uint8Array;
    mime: string;
  }): Promise<void>;
  /**
   * get -- the bytes of a key
   *
   * # About
   *
   * > The whole blob, as stored.
   *
   * Throws a 404 for a key that does not exist.
   *
   * # Who needs it
   *
   * `FileStore.getBytes`.
   */
  get(args: {key: string}): Promise<Uint8Array>;
  /**
   * signedUrl -- a URL that serves the blob for a while
   *
   * # About
   *
   * > The storage serves the file, not the gateway.
   *
   * A URL valid for `ttlSec` seconds. Throws a 404 for a key that does not exist.
   *
   * # Who needs it
   *
   * `FileStore.getSignedUrl`.
   */
  signedUrl(args: {
    key: string;
    ttlSec: number;
  }): Promise<string>;
  /**
   * remove -- deletes one blob
   *
   * # About
   *
   * > Nothing when the key does not exist.
   *
   * Removes the bytes and the media type stored under the key.
   *
   * # Who needs it
   *
   * `FileStore.remove`.
   */
  remove(args: {key: string}): Promise<void>;
  /**
   * removeByPrefix -- deletes every blob under a prefix
   *
   * # About
   *
   * > A folder at a time: the prefix ends with "/".
   *
   * Removes every blob whose key starts with the prefix and returns how many went.
   *
   * # Who needs it
   *
   * `FileStore.removeFilesByUser`, for the user's folder (GDPR erasure).
   */
  removeByPrefix(args: {prefix: string}): Promise<number>;
}
