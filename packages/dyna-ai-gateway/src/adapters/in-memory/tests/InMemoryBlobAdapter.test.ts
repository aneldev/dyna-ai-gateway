import {InMemoryBlobAdapter} from "../InMemoryBlobAdapter";

const putBlob = async (adapter: InMemoryBlobAdapter, key: string, bytes: number[]): Promise<void> => {
  await adapter.put({
    key,
    bytes: new Uint8Array(bytes),
    mime: "image/png",
  });
};

describe("InMemoryBlobAdapter", () => {
  test("get returns the bytes that were put", async () => {
    const adapter = new InMemoryBlobAdapter();
    await putBlob(adapter, "tenant-a/file-1", [1, 2, 3]);
    expect(await adapter.get({key: "tenant-a/file-1"})).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("put replaces the blob with the same key", async () => {
    const adapter = new InMemoryBlobAdapter();
    await putBlob(adapter, "tenant-a/file-1", [1, 2, 3]);
    await putBlob(adapter, "tenant-a/file-1", [9]);
    expect(await adapter.get({key: "tenant-a/file-1"})).toEqual(new Uint8Array([9]));
  });

  test("get throws a 404 when the key does not exist", async () => {
    const adapter = new InMemoryBlobAdapter();
    await expect(adapter.get({key: "missing"})).rejects.toMatchObject({
      status: 404,
      data: {key: "missing"},
    });
  });

  test("signedUrl returns an in-memory url that carries the key and the ttl", async () => {
    const adapter = new InMemoryBlobAdapter();
    await putBlob(adapter, "tenant-a/file-1", [1]);
    expect(await adapter.signedUrl({
      key: "tenant-a/file-1",
      ttlSec: 900,
    })).toBe("in-memory://tenant-a%2Ffile-1?ttlSec=900");
  });

  test("signedUrl throws when the key does not exist", async () => {
    const adapter = new InMemoryBlobAdapter();
    await expect(adapter.signedUrl({
      key: "missing",
      ttlSec: 900,
    })).rejects.toThrow("blob not found [missing]");
  });

  test("remove deletes the blob", async () => {
    const adapter = new InMemoryBlobAdapter();
    await putBlob(adapter, "tenant-a/file-1", [1]);
    await adapter.remove({key: "tenant-a/file-1"});
    await expect(adapter.get({key: "tenant-a/file-1"})).rejects.toThrow("blob not found");
  });

  test("changing the bytes after put does not change the stored blob", async () => {
    const adapter = new InMemoryBlobAdapter();
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.put({
      key: "tenant-a/file-1",
      bytes,
      mime: "image/png",
    });
    bytes[0] = 9;
    expect(await adapter.get({key: "tenant-a/file-1"})).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("removeByPrefix removes every blob under the prefix and returns their number", async () => {
    const adapter = new InMemoryBlobAdapter();
    for (const key of ["a/1", "a/2", "ab/1"]) {
      await adapter.put({
        key,
        bytes: new Uint8Array([1]),
        mime: "image/png",
      });
    }
    const removed = await adapter.removeByPrefix({prefix: "a/"});
    await expect(adapter.get({key: "a/1"})).rejects.toMatchObject({status: 404});
    expect([removed, (await adapter.get({key: "ab/1"})).length]).toEqual([2, 1]);
  });
});
