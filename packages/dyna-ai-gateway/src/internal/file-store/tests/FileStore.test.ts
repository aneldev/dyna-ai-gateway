import {InMemoryBlobAdapter} from "../../../adapters/in-memory";
import {IFileRef} from "../../../contracts";

import {FileStore} from "../FileStore";
import {IFileStoreConfig} from "../types";

interface ISetup {
  store: FileStore;
  adapter: InMemoryBlobAdapter;
}

const setup = (config: Partial<IFileStoreConfig> = {}): ISetup => {
  const adapter = new InMemoryBlobAdapter();
  return {
    adapter,
    store: new FileStore({
      adapter,
      path: "apps/crm/ai-files",
      ...config,
    }),
  };
};

const bytes = new Uint8Array([1, 2, 3, 4]);

const owner = {
  tenantId: "tenant-a",
  userId: "user-a",
};

const put = (store: FileStore, overrides: Partial<Parameters<FileStore["put"]>[0]> = {}): Promise<IFileRef> =>
  store.put({
    ...owner,
    bytes,
    mime: "image/png",
    name: "invoice.png",
    ...overrides,
  });

/** The lint rule of the testing library reads every "getBy…" call as a DOM query: the call stays out of the test bodies. */
const loadBytes = (store: FileStore, fileId: string, of: {tenantId: string; userId: string} = owner): Promise<Uint8Array> =>
  store.getBytes({
    ...of,
    fileId,
  });

describe("FileStore", () => {
  describe("M6 — put", () => {
    test("returns the pointer of the stored file: a new id, the tenant, the user, the type, the size and the name", async () => {
      const {store} = setup();
      const file = await put(store);
      expect([file, Boolean(file.id)]).toEqual([
        {
          id: file.id,
          tenantId: "tenant-a",
          userId: "user-a",
          mime: "image/png",
          size: 4,
          name: "invoice.png",
        },
        true,
      ]);
    });

    test("every upload gets its own id", async () => {
      const {store} = setup();
      expect((await put(store)).id).not.toBe((await put(store)).id);
    });

    test("stores the bytes at <tenantId>/<path>/<userId>/<fileId> with their type", async () => {
      const {
        store,
        adapter,
      } = setup();
      const spy = jest.spyOn(adapter, "put");
      const file = await put(store);
      expect(spy.mock.calls[0][0]).toEqual({
        key: `tenant-a/apps/crm/ai-files/user-a/${file.id}`,
        bytes,
        mime: "image/png",
      });
    });

    test.each([["image/png"], ["image/jpeg"], ["application/pdf"]])("by default %s is allowed", async mime => {
      const {store} = setup();
      expect((await put(store, {mime})).mime).toBe(mime);
    });

    test.each([["text/html"], ["application/zip"], ["imagex/png"]])("by default %s is refused with a 400", async mime => {
      const {store} = setup();
      await expect(put(store, {mime})).rejects.toMatchObject({
        code: 5372795409348,
        status: 400,
      });
    });

    test("allowedMime of the config replaces the default list", async () => {
      const {store} = setup({allowedMime: ["text/plain"]});
      const text = await put(store, {mime: "text/plain"});
      await expect(put(store, {mime: "image/png"})).rejects.toMatchObject({status: 400});
      expect(text.mime).toBe("text/plain");
    });

    test("a file over maxBytes is a 413 and is not stored", async () => {
      const {
        store,
        adapter,
      } = setup({maxBytes: 3});
      const spy = jest.spyOn(adapter, "put");
      await expect(put(store)).rejects.toMatchObject({
        code: 5372795409561,
        status: 413,
      });
      expect(spy).not.toHaveBeenCalled();
    });

    test("an empty file is a 400", async () => {
      const {store} = setup();
      await expect(put(store, {bytes: new Uint8Array()})).rejects.toMatchObject({status: 400});
    });
  });

  describe("M6 — the configured path", () => {
    const getKey = async (path: string): Promise<string> => {
      const {
        store,
        adapter,
      } = setup({path});
      const spy = jest.spyOn(adapter, "put");
      const file = await put(store);
      return spy.mock.calls[0][0].key.replace(file.id, "<fileId>");
    };

    test("the path can have any number of folders", async () => {
      expect(await getKey("company/apps/crm/ai/files")).toBe("tenant-a/company/apps/crm/ai/files/user-a/<fileId>");
    });

    test.each([
      ["/apps/crm"],
      ["apps/crm/"],
      ["/apps/crm/"],
      ["//apps//crm//"],
    ])("a path that begins or ends with a slash gives no doubled slash in the key (%s)", async path => {
      expect(await getKey(path)).toBe("tenant-a/apps/crm/user-a/<fileId>");
    });

    test("a path of only a slash is like an empty path", async () => {
      expect(await getKey("/")).toBe("tenant-a/user-a/<fileId>");
    });

    test("an empty path stores the files directly in the tenant's folder", async () => {
      expect(await getKey("")).toBe("tenant-a/user-a/<fileId>");
    });

    test("a path that steps out of its folder is refused when the store is created", () => {
      expect(() => setup({path: "apps/../other"})).toThrow(expect.objectContaining({
        code: 5372797101150,
        status: 400,
      }));
    });
  });

  describe("M6 — getBytes", () => {
    test("returns the bytes that were stored", async () => {
      const {store} = setup();
      const file = await put(store);
      expect(await loadBytes(store, file.id)).toEqual(bytes);
    });

    test("an unknown file is a 404", async () => {
      const {store} = setup();
      await expect(loadBytes(store, "missing")).rejects.toMatchObject({status: 404});
    });

    test("the file of another tenant is a 404", async () => {
      const {store} = setup();
      const file = await put(store);
      await expect(loadBytes(store, file.id, {
        tenantId: "tenant-b",
        userId: "user-a",
      })).rejects.toMatchObject({status: 404});
    });

    test("the file is not found under another user", async () => {
      const {store} = setup();
      const file = await put(store);
      await expect(loadBytes(store, file.id, {
        tenantId: "tenant-a",
        userId: "user-b",
      })).rejects.toMatchObject({status: 404});
    });

    test.each([
      ["a file id", {fileId: "../user-a/x"}],
      ["a user id", {userId: ".."}],
      ["a tenant id", {tenantId: "tenant-a/user-a"}],
    ])("%s that tries to leave its folder is refused with a 400", async (_name, overrides) => {
      const {store} = setup();
      await expect(store.getBytes({
        ...owner,
        fileId: "file-1",
        ...overrides,
      })).rejects.toMatchObject({status: 400});
    });
  });

  describe("M6 — getSignedUrl", () => {
    test("returns the adapter's url for the file, valid 900 seconds by default", async () => {
      const {
        store,
        adapter,
      } = setup();
      const spy = jest.spyOn(adapter, "signedUrl");
      const file = await put(store);
      const url = await store.getSignedUrl({
        ...owner,
        fileId: file.id,
      });
      expect([Boolean(url), spy.mock.calls[0][0]]).toEqual([
        true,
        {
          key: `tenant-a/apps/crm/ai-files/user-a/${file.id}`,
          ttlSec: 900,
        },
      ]);
    });

    test("ttlSec of the call is passed on", async () => {
      const {
        store,
        adapter,
      } = setup();
      const spy = jest.spyOn(adapter, "signedUrl");
      const file = await put(store);
      await store.getSignedUrl({
        ...owner,
        fileId: file.id,
        ttlSec: 60,
      });
      expect(spy.mock.calls[0][0].ttlSec).toBe(60);
    });

    test("an unknown file is a 404", async () => {
      const {store} = setup();
      await expect(store.getSignedUrl({
        ...owner,
        fileId: "missing",
      })).rejects.toMatchObject({status: 404});
    });
  });

  describe("M6 — remove", () => {
    test("removes the file: its bytes are gone", async () => {
      const {store} = setup();
      const file = await put(store);
      await store.remove({
        ...owner,
        fileId: file.id,
      });
      await expect(loadBytes(store, file.id)).rejects.toMatchObject({status: 404});
    });

    test("another tenant cannot remove the file", async () => {
      const {store} = setup();
      const file = await put(store);
      await store.remove({
        tenantId: "tenant-b",
        userId: "user-a",
        fileId: file.id,
      });
      expect(await loadBytes(store, file.id)).toEqual(bytes);
    });

    test("removing a file that is not there changes nothing", async () => {
      const {store} = setup();
      await expect(store.remove({
        ...owner,
        fileId: "missing",
      })).resolves.toBeUndefined();
    });
  });

  describe("M6 — removeFilesByUser", () => {
    const otherUser = {
      tenantId: "tenant-a",
      userId: "user-ab",
    };
    const otherTenant = {
      tenantId: "tenant-b",
      userId: "user-a",
    };

    test("deletes every file the user uploaded and returns their number", async () => {
      const {store} = setup();
      const files = [await put(store), await put(store), await put(store)];
      const deleted = await store.removeFilesByUser(owner);
      await expect(loadBytes(store, files[0].id)).rejects.toMatchObject({status: 404});
      await expect(loadBytes(store, files[2].id)).rejects.toMatchObject({status: 404});
      expect(deleted).toBe(3);
    });

    test("leaves the files of another user, also one whose id starts with the same letters", async () => {
      const {store} = setup();
      await put(store);
      const kept = await put(store, otherUser);
      await store.removeFilesByUser(owner);
      expect(await loadBytes(store, kept.id, otherUser)).toEqual(bytes);
    });

    test("leaves the files of the same user id in another tenant", async () => {
      const {store} = setup();
      await put(store);
      const kept = await put(store, otherTenant);
      await store.removeFilesByUser(owner);
      expect(await loadBytes(store, kept.id, otherTenant)).toEqual(bytes);
    });

    test("a user without files: nothing is deleted", async () => {
      const {store} = setup();
      expect(await store.removeFilesByUser(owner)).toBe(0);
    });
  });
});
