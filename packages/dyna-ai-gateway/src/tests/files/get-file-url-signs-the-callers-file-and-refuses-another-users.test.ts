import {
  AIGateway,
  IUserContext,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigGetFileUrl} from "./get-file-url.config";

/**
 * `getFileUrl` is the facade of `FileStore.getSignedUrl`: the adapter signs the calling user's file for `ttlSec` seconds
 * (900 by default); the same id under another user of the tenant is a 404, as the file is its uploader's.
 */
test("getFileUrl returns the adapter's signed URL of the caller's file, with the given or the default ttl, and a 404 for another user", async () => {
  const gateway = new AIGateway(gatewayConfigGetFileUrl, {llmClient: () => new FakeLLMClient()});
  const file = await gateway.uploadFile({
    userContext: sampleUserContext,
    bytes: new Uint8Array([137, 80, 78, 71]),
    mime: "image/png",
    name: "invoice.png",
  });
  const otherUser: IUserContext = {
    ...sampleUserContext,
    userId: "another-user",
  };

  const [defaultTtl, shortTtl] = await Promise.all([
    gateway.getFileUrl({
      userContext: sampleUserContext,
      fileId: file.id,
    }),
    gateway.getFileUrl({
      userContext: sampleUserContext,
      fileId: file.id,
      ttlSec: 60,
    }),
  ]);

  await expect(gateway.getFileUrl({
    userContext: otherUser,
    fileId: file.id,
  })).rejects.toMatchObject({status: 404});
  expect([defaultTtl, shortTtl]).toEqual([
    expect.stringMatching(/^in-memory:\/\/.+\?ttlSec=900$/),
    expect.stringMatching(/^in-memory:\/\/.+\?ttlSec=60$/),
  ]);
});
