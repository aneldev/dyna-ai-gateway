import {
  IFileRef,
  IInlineFilePart,
  IUserContext,
  TGatewayResponse,
  TMessagePart,
  EGatewayResponseKind,
  EIssueSeverity,
  EModelProvider,
  EPartKind,
  ETurnRole,
} from "../..";

import {
  IGatewaySetup,
  makeGateway,
  makeModelResult,
  noKb,
  userContext,
} from "../internal/utils/makeGateway";
import {loadTurns} from "../internal/utils/makeToolGateway";

const pngBytes = new Uint8Array([137, 80, 78, 71]);

const otherUser: IUserContext = {
  ...userContext,
  userId: "user-b",
};

/** A gateway whose model "model-a" can read the given kinds of files. */
const setupFiles = async (caps: {images?: boolean; pdf?: boolean} = {images: true}): Promise<IGatewaySetup> => {
  const setup = await makeGateway();
  const model = await setup.gateway.modelRegistry.getModel({modelId: "model-a"});
  await setup.gateway.modelRegistry.upsertModel({
    model: {
      ...model,
      provider: EModelProvider.OPENAI,
      caps: {
        ...model.caps,
        images: caps.images ?? false,
        pdf: caps.pdf ?? false,
      },
    },
  });
  return setup;
};

const upload = ({gateway}: IGatewaySetup, overrides: Partial<Parameters<IGatewaySetup["gateway"]["uploadFile"]>[0]> = {}): Promise<IFileRef> =>
  gateway.uploadFile({
    userContext,
    bytes: pngBytes,
    mime: "image/png",
    name: "invoice.png",
    ...overrides,
  });

const ask = (setup: IGatewaySetup, files: IFileRef[], prompt = "What is on this invoice?", threadId?: string): Promise<TGatewayResponse> => {
  setup.llmClient.enqueueComplete(makeModelResult());
  return setup.gateway.ask({
    profileId: "default",
    userContext,
    prompt,
    files,
    threadId,
    kbFilters: noKb,
  }).response;
};

/** The parts of the last message of the last request the model got. */
const getLastParts = ({llmClient}: IGatewaySetup): TMessagePart[] => llmClient.completeCalls.at(-1)?.request.messages.at(-1)?.parts ?? [];

const getInlineFiles = (setup: IGatewaySetup): IInlineFilePart[] =>
  getLastParts(setup).filter((part): part is IInlineFilePart => part.kind === EPartKind.INLINE_FILE);

describe("AIGateway — M6: files", () => {
  describe("uploadFile and deleteFile", () => {
    test("uploadFile stores the file for the calling user and returns its pointer", async () => {
      const setup = await setupFiles();
      expect(await upload(setup)).toMatchObject({
        tenantId: "tenant-a",
        userId: "user-a",
        mime: "image/png",
        size: 4,
        name: "invoice.png",
      });
    });

    test("deleteFile removes the caller's file: a question with it is a 404", async () => {
      const setup = await setupFiles();
      const file = await upload(setup);
      await setup.gateway.deleteFile({
        userContext,
        fileId: file.id,
      });
      await expect(ask(setup, [file])).rejects.toMatchObject({status: 404});
    });

    test("deleteFile does not remove the file of another user", async () => {
      const setup = await setupFiles();
      const file = await upload(setup);
      await setup.gateway.deleteFile({
        userContext: otherUser,
        fileId: file.id,
      });
      expect((await ask(setup, [file])).kind).toBe(EGatewayResponseKind.ANSWER);
    });
  });

  describe("a question with files", () => {
    test("an image part reaches the LLMClient only when caps.images is true", async () => {
      const withImages = await setupFiles({images: true});
      const withoutImages = await setupFiles({images: false});
      await ask(withImages, [await upload(withImages)]);
      await ask(withoutImages, [await upload(withoutImages)]);
      expect([getInlineFiles(withImages).length, getInlineFiles(withoutImages).length]).toEqual([1, 0]);
    });

    test("the file goes into the message of the question, after its text, with its bytes, type and name", async () => {
      const setup = await setupFiles();
      const file = await upload(setup);
      await ask(setup, [file]);
      expect(getLastParts(setup)).toEqual([
        {
          kind: EPartKind.TEXT,
          text: "What is on this invoice?",
        },
        {
          kind: EPartKind.INLINE_FILE,
          mime: "image/png",
          bytes: pngBytes,
          name: "invoice.png",
          fileId: file.id,
          size: pngBytes.byteLength,
        },
      ]);
    });

    test("a file the model cannot read is left out with a WARNING file_dropped; the question is still answered", async () => {
      const setup = await setupFiles({images: false});
      const response = await ask(setup, [await upload(setup)]);
      expect([response.kind, response.kind === EGatewayResponseKind.ANSWER && response.issues.map(issue => [issue.code, issue.severity])])
        .toEqual([EGatewayResponseKind.ANSWER, [["file_dropped", EIssueSeverity.WARNING]]]);
    });

    test("a PDF reaches the model only when caps.pdf is true", async () => {
      const withPdf = await setupFiles({pdf: true});
      const withoutPdf = await setupFiles({images: true});
      const pdf = {
        mime: "application/pdf",
        name: "invoice.pdf",
      };
      await ask(withPdf, [await upload(withPdf, pdf)]);
      await ask(withoutPdf, [await upload(withoutPdf, pdf)]);
      expect([getInlineFiles(withPdf).map(file => file.mime), getInlineFiles(withoutPdf).length]).toEqual([["application/pdf"], 0]);
    });

    test("a question that is only a file, without text, is sent as a message of its own", async () => {
      const setup = await setupFiles();
      const response = await ask(setup, [await upload(setup)], "");
      expect([response.kind, getLastParts(setup).map(part => part.kind)]).toEqual([EGatewayResponseKind.ANSWER, [EPartKind.INLINE_FILE]]);
    });

    test("the thread keeps the pointer of the file, not its bytes", async () => {
      const setup = await setupFiles();
      const file = await upload(setup);
      const response = await ask(setup, [file]);
      const [userTurn] = await loadTurns(setup, response.threadId ?? "");
      expect([userTurn.role, userTurn.parts.at(-1)]).toEqual([
        ETurnRole.USER,
        {
          kind: EPartKind.FILE,
          file,
        },
      ]);
    });

    test("the next question of the thread does not send the file again", async () => {
      const setup = await setupFiles();
      const response = await ask(setup, [await upload(setup)]);
      await ask(setup, [], "And what is its total?", response.threadId);
      const kinds = setup.llmClient.completeCalls.at(-1)?.request.messages.flatMap(message => message.parts.map(part => part.kind));
      expect(kinds?.includes(EPartKind.INLINE_FILE)).toBe(false);
    });

    test("a file that does not exist is a 404, and no thread is created for the question", async () => {
      const setup = await setupFiles();
      const file = await upload(setup);
      const save = jest.spyOn(setup.config.threadStore.repository, "saveThread");
      await expect(ask(setup, [{
        ...file,
        id: "missing",
      }])).rejects.toMatchObject({status: 404});
      expect(save).not.toHaveBeenCalled();
    });

    test("a pointer of another tenant is a 400", async () => {
      const setup = await setupFiles();
      const file = await upload(setup);
      await expect(ask(setup, [{
        ...file,
        tenantId: "tenant-b",
      }])).rejects.toMatchObject({
        code: 5372799783963,
        status: 400,
      });
    });
  });

  describe("removeFilesByUser", () => {
    test("removes every file of the user and returns their number", async () => {
      const setup = await setupFiles();
      const file = await upload(setup);
      await upload(setup);
      const removed = await setup.gateway.removeFilesByUser({
        tenantId: "tenant-a",
        userId: "user-a",
      });
      await expect(ask(setup, [file])).rejects.toMatchObject({status: 404});
      expect(removed).toBe(2);
    });

    test("leaves the files of another user", async () => {
      const setup = await setupFiles();
      const kept = await upload(setup, {userContext: otherUser});
      await upload(setup);
      await setup.gateway.removeFilesByUser({
        tenantId: "tenant-a",
        userId: "user-a",
      });
      // Asked by its owner: a question may carry only the caller's own files
      setup.llmClient.enqueueComplete(makeModelResult());
      const answer = await setup.gateway.ask({
        profileId: "default",
        userContext: otherUser,
        prompt: "What is on this invoice?",
        files: [kept],
        kbFilters: noKb,
      }).response;
      expect(answer.kind).toBe(EGatewayResponseKind.ANSWER);
    });
  });
});
