import {dynaError} from "dyna-error";

import {
  AIGateway,
  EGatewayResponseKind,
  EPartKind,
  ETurnRole,
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
 * A pointer stored in a turn before the gateway checked the uploader may name another user's file. `delete` removes the
 * thread owner's files with the thread: the other user's file stays.
 */
test("delete removes the owner's files with the thread and leaves a stored pointer of another user's file", async () => {
  const llmClient = new FakeLLMClient();
  const gateway = new AIGateway(gatewayConfigFileOfAnotherUser, {llmClient: () => llmClient});
  const {repository} = gatewayConfigFileOfAnotherUser.threadStore;
  const {tenantId} = sampleUserContext;
  const otherUser: IUserContext = {
    ...sampleUserContext,
    userId: "another-user",
  };
  const upload = (userContext: IUserContext): ReturnType<AIGateway["uploadFile"]> => gateway.uploadFile({
    userContext,
    bytes: new Uint8Array([137, 80, 78, 71]),
    mime: "image/png",
    name: "invoice.png",
  });
  const ownFile = await upload(sampleUserContext);
  const otherFile = await upload(otherUser);
  const ask = (userContext: IUserContext, file: typeof ownFile): ReturnType<AIGateway["ask"]>["response"] => {
    llmClient.enqueueComplete(makeModelResult({
      modelId: openAiModel.id,
      text: "An invoice.",
    }));
    return gateway.ask({
      profileId: "default",
      userContext,
      prompt: "What is on this invoice?",
      files: [file],
      kbFilters: noKb,
    }).response;
  };
  const answer = await ask(sampleUserContext, ownFile);
  if (answer.kind !== EGatewayResponseKind.ANSWER) {
    throw dynaError({
      code: 5377210486131,
      message: `Test setup: expected ANSWER, got ${answer.kind}`,
      data: {answer},
    });
  }
  // A turn as stored before the check: it points at the other user's file
  await repository.appendTurn({
    tenantId,
    threadId: answer.threadId,
    turn: {
      id: "old-turn",
      role: ETurnRole.USER,
      parts: [{
        kind: EPartKind.FILE,
        file: otherFile,
      }],
      createdAt: new Date(),
    },
  });
  const thread = await repository.loadThread({
    tenantId,
    threadId: answer.threadId,
  });
  if (!thread) {
    throw dynaError({
      code: 5377210486137,
      message: "Test setup: the thread of the answer is not stored",
      data: {threadId: answer.threadId},
    });
  }
  await repository.saveThread({
    thread: {
      ...thread,
      turnCount: thread.turnCount + 1,
    },
  });

  const deleted = await gateway.delete({
    tenantId,
    threadIds: [answer.threadId],
  });

  await expect(ask(sampleUserContext, ownFile)).rejects.toMatchObject({status: 404});
  expect([
    deleted,
    (await ask(otherUser, otherFile)).kind,
  ]).toEqual([
    {threads: 1},
    EGatewayResponseKind.ANSWER,
  ]);
});
