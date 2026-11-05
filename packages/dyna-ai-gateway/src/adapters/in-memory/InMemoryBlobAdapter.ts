import {dynaError} from "dyna-error";

import {IBlobAdapter} from "../../internal/file-store";

/** One stored blob: its bytes and the media type they were put with. */
interface IBlob {
  /** A copy of the bytes, as `put` received them. */
  bytes: Uint8Array;
  /** The media type, for the signed URL. */
  mime: string;
}

/**
 * InMemoryBlobAdapter -- the blob adapter in a Map, for tests and the sandbox
 *
 * # About
 *
 * > Behaves like a bucket without one: copies in and out, keys with "/" as folders.
 *
 * Implements `IBlobAdapter` so the `FileStore` runs with no infrastructure. `signedUrl` returns an `in-memory://` URL
 * that nothing serves: a test asserts on it, a browser cannot open it.
 *
 * # Who needs it
 *
 * The gateway tests (`gatewayConfigBase`), the dev sandbox and the cookbook's first run; a host app uses its own adapter.
 *
 * # Pitfalls
 *
 * Production: nothing survives the process, nothing is shared between processes.
 */
export class InMemoryBlobAdapter implements IBlobAdapter {
  private readonly blobs = new Map<string, IBlob>();

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
  public async put(
    {
      key,
      bytes,
      mime,
    }: {
      key: string;
      bytes: Uint8Array;
      mime: string;
    },
  ): Promise<void> {
    this.blobs.set(
      key,
      {
        bytes: bytes.slice(),
        mime: mime,
      },
    );
  }

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
  public async get(
    {key}: {key: string},
  ): Promise<Uint8Array> {
    return this.getBlob(key).bytes.slice();
  }

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
  public async signedUrl(
    {
      key,
      ttlSec,
    }: {
      key: string;
      ttlSec: number;
    },
  ): Promise<string> {
    this.getBlob(key);
    return `in-memory://${encodeURIComponent(key)}?ttlSec=${ttlSec}`;
  }

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
  public async remove(
    {key}: {key: string},
  ): Promise<void> {
    this.blobs.delete(key);
  }

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
  public async removeByPrefix(
    {prefix}: {prefix: string},
  ): Promise<number> {
    const keys = [...this.blobs.keys()].filter(key => key.startsWith(prefix));
    keys.forEach(key => this.blobs.delete(key));
    return keys.length;
  }

  /** The blob under the key, or a 404. */
  private getBlob(key: string): IBlob {
    const blob = this.blobs.get(key);
    if (!blob) {
      throw dynaError({
        code: 5372567786016,
        status: 404,
        message: `InMemoryBlobAdapter: blob not found [${key}]`,
        data: {key},
      });
    }
    return blob;
  }
}
