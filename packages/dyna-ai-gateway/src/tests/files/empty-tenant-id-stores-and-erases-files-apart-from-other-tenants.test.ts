import {
  AIGateway,
  IUserContext,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigEmptyTenantId} from "./empty-tenant-id.config";

/**
 * An empty tenant id is a tenant like any other (D130): a single-tenant application passes "" and its files are stored,
 * signed and erased. Its key keeps the empty first folder (`/acme/<fileId>`), so erasing its user "acme" leaves the
 * files of the tenant "acme" (`acme/x/<fileId>`) in place, although the file path is empty.
 */
test("an empty tenant id stores, signs and erases its files, and the erasure leaves the tenant named like its user untouched", async () => {
  const gateway = new AIGateway(gatewayConfigEmptyTenantId, {llmClient: () => new FakeLLMClient()});
  const noTenantUser: IUserContext = {
    ...sampleUserContext,
    tenantId: "",
    userId: "acme",
  };
  const tenantAcmeUser: IUserContext = {
    ...sampleUserContext,
    tenantId: "acme",
    userId: "x",
  };
  const upload = (userContext: IUserContext): ReturnType<AIGateway["uploadFile"]> => gateway.uploadFile({
    userContext,
    bytes: new Uint8Array([137, 80, 78, 71]),
    mime: "image/png",
    name: "invoice.png",
  });
  const [noTenantFile, tenantAcmeFile] = [await upload(noTenantUser), await upload(tenantAcmeUser)];

  const noTenantUrl = await gateway.getFileUrl({
    userContext: noTenantUser,
    fileId: noTenantFile.id,
  });
  const erased = await gateway.deleteUserData({
    tenantId: "",
    userId: "acme",
  });

  expect(decodeURIComponent(noTenantUrl)).toMatch(new RegExp(`^in-memory:///acme/${noTenantFile.id}\\?`));
  expect(erased.files).toBe(1);
  await expect(gateway.getFileUrl({
    userContext: noTenantUser,
    fileId: noTenantFile.id,
  })).rejects.toMatchObject({status: 404});
  const tenantAcmeUrl = await gateway.getFileUrl({
    userContext: tenantAcmeUser,
    fileId: tenantAcmeFile.id,
  });
  expect(decodeURIComponent(tenantAcmeUrl)).toMatch(new RegExp(`^in-memory://acme/x/${tenantAcmeFile.id}\\?`));
});
