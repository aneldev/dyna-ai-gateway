import {
  AIGateway,
  EGatewayResponseKind,
  IUserContext,
} from "../..";

import {FakeLLMClient} from "../internal/fakes/FakeLLMClient";
import {openAiModel} from "../internal/samples/models";
import {
  makeModelResult,
  noKb,
} from "../internal/utils/makeGateway";
import {sampleUserContext} from "../internal/utils/sampleUserContext";

import {gatewayConfigFileOfAnotherUser} from "./file-of-another-user.config";

/**
 * A file pointer comes from the client: its `userId` is not trusted. A question that carries another user's file of the tenant
 * is a 400 before anything is stored, and the file stays readable for its owner.
 */
test("ask with a file pointer of another user is a 400, stores nothing, and the owner still reads the file", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigFileOfAnotherUser, {llmClient: () => llmClient});
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
  const saveThread = jest.spyOn(gatewayConfigFileOfAnotherUser.threadStore.repository, "saveThread");

  const foreign = gateway.ask({
    profileId: "default",
    userContext: otherUser,
    prompt: "What is on this invoice?",
    // The owner's pointer as uploaded: tenant and id are right, only the caller is not the uploader
    files: [file],
    kbFilters: noKb,
  }).response;
  await expect(foreign).rejects.toMatchObject({
    code: 5377210486127,
    status: 400,
    data: {fileId: file.id},
  });
  expect(saveThread).not.toHaveBeenCalled();

  llmClient.enqueueComplete(makeModelResult({
    modelId: openAiModel.id,
    text: "An invoice.",
  }));
  const own = await gateway.ask({
    profileId: "default",
    userContext: sampleUserContext,
    prompt: "What is on this invoice?",
    files: [file],
    kbFilters: noKb,
  }).response;
  expect(own.kind).toBe(EGatewayResponseKind.ANSWER);
});
