import {InMemoryBlobAdapter} from "../../../adapters/in-memory";

import {FileStore} from "../FileStore";

/** An SVG can carry a script: the default list names the image types one by one, and SVG is not among them. */
test("put refuses image/svg+xml with the default allowed types, and accepts it when the host allows it", async () => {
  const upload = (store: FileStore): ReturnType<FileStore["put"]> => store.put({
    tenantId: "tenant-a",
    userId: "user-a",
    bytes: new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"),
    mime: "image/svg+xml",
    name: "logo.svg",
  });

  await expect(upload(new FileStore({
    adapter: new InMemoryBlobAdapter(),
    path: "ai-files",
  }))).rejects.toMatchObject({
    code: 5372795409348,
    status: 400,
  });
  const allowed = await upload(new FileStore({
    adapter: new InMemoryBlobAdapter(),
    path: "ai-files",
    allowedMime: ["image/*"],
  }));
  expect(allowed.mime).toBe("image/svg+xml");
});
