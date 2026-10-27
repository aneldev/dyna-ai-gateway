import {dynaError} from "dyna-error";

import {IBlobAdapter} from "../../internal/file-store";

interface IBlob {
  bytes: Uint8Array;
  mime: string;
}

/** Blobs in a Map. `signedUrl` returns an `in-memory://` url that nothing serves. */
export class InMemoryBlobAdapter implements IBlobAdapter {
  private readonly blobs = new Map<string, IBlob>();

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

  /** Throws when the key does not exist. */
  public async get(
    {key}: {key: string},
  ): Promise<Uint8Array> {
    return this.getBlob(key).bytes.slice();
  }

  /** Throws when the key does not exist. */
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

  public async remove(
    {key}: {key: string},
  ): Promise<void> {
    this.blobs.delete(key);
  }

  public async removeByPrefix(
    {prefix}: {prefix: string},
  ): Promise<number> {
    const keys = [...this.blobs.keys()].filter(key => key.startsWith(prefix));
    keys.forEach(key => this.blobs.delete(key));
    return keys.length;
  }

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
