import {IPageArgs} from "../../../contracts";
import {
  IPromptTemplate,
  EPromptTemplateKey,
} from "../../../internal/prompt-template-store";

import {InMemoryPromptTemplateRepository} from "../InMemoryPromptTemplateRepository";

const makeTemplate = (key: EPromptTemplateKey, version: number, body = "Hello {name}", isActive = false): IPromptTemplate => ({
  key,
  version,
  body,
  isActive,
  updatedAt: new Date(1_000),
});

const firstPage = (limit: number): IPageArgs<number> => ({
  limit,
  startingAfter: null,
  endingBefore: null,
});

const setup = async (templates: IPromptTemplate[]): Promise<InMemoryPromptTemplateRepository> => {
  const repository = new InMemoryPromptTemplateRepository();
  for (const template of templates) await repository.save({template});
  return repository;
};

describe("InMemoryPromptTemplateRepository", () => {
  test("loadActive returns an empty list when nothing is saved", async () => {
    const repository = await setup([]);
    expect(await repository.loadActive()).toEqual([]);
  });

  test("loadActive returns only the active template of each key", async () => {
    const repository = await setup([
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1),
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 2, "Hello {name}", true),
      makeTemplate(EPromptTemplateKey.THREAD_TITLE, 1, "Title", true),
    ]);
    expect((await repository.loadActive()).map(template => `${template.key}#${template.version}`))
      .toEqual(["CHAT_MAIN#2", "THREAD_TITLE#1"]);
  });

  test("get returns the version or null when it does not exist", async () => {
    const repository = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1)]);
    expect([
      await repository.get({
        key: EPromptTemplateKey.CHAT_MAIN,
        version: 1,
      }),
      await repository.get({
        key: EPromptTemplateKey.CHAT_MAIN,
        version: 2,
      }),
    ]).toEqual([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1), null]);
  });

  test("save keeps every version of a key", async () => {
    const repository = await setup([
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1),
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 2),
    ]);
    const {items} = await repository.listVersions({
      key: EPromptTemplateKey.CHAT_MAIN,
      page: firstPage(10),
    });
    expect(items.map(template => template.version)).toEqual([2, 1]);
  });

  test("save replaces the template with the same key and version", async () => {
    const repository = await setup([
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Old"),
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "New"),
    ]);
    const {items} = await repository.listVersions({
      key: EPromptTemplateKey.CHAT_MAIN,
      page: firstPage(10),
    });
    expect(items).toEqual([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "New")]);
  });

  test("listVersions pages newest first and reports hasMore", async () => {
    const repository = await setup([1, 2, 3, 4, 5].map(version => makeTemplate(EPromptTemplateKey.CHAT_MAIN, version)));
    const page1 = await repository.listVersions({
      key: EPromptTemplateKey.CHAT_MAIN,
      page: firstPage(2),
    });
    const page2 = await repository.listVersions({
      key: EPromptTemplateKey.CHAT_MAIN,
      page: {
        limit: 2,
        startingAfter: null,
        endingBefore: 4,
      },
    });
    const page3 = await repository.listVersions({
      key: EPromptTemplateKey.CHAT_MAIN,
      page: {
        limit: 2,
        startingAfter: null,
        endingBefore: 2,
      },
    });
    expect([
      page1.items.map(template => template.version), page1.hasMore,
      page2.items.map(template => template.version), page2.hasMore,
      page3.items.map(template => template.version), page3.hasMore,
    ]).toEqual([[5, 4], true, [3, 2], true, [1], false]);
  });

  test("listVersions with startingAfter returns the versions newer than the cursor, next to it", async () => {
    const repository = await setup([1, 2, 3, 4, 5].map(version => makeTemplate(EPromptTemplateKey.CHAT_MAIN, version)));
    const page = await repository.listVersions({
      key: EPromptTemplateKey.CHAT_MAIN,
      page: {
        limit: 2,
        startingAfter: 1,
        endingBefore: null,
      },
    });
    expect([page.items.map(template => template.version), page.hasMore]).toEqual([[3, 2], true]);
  });

  test("listVersions throws a 404 with code 5386034892563 for a cursor version that does not exist", async () => {
    const repository = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1)]);
    await expect(repository.listVersions({
      key: EPromptTemplateKey.CHAT_MAIN,
      page: {
        limit: 2,
        startingAfter: null,
        endingBefore: 9,
      },
    })).rejects.toMatchObject({
      code: 5386034892563,
      status: 404,
      data: {
        key: EPromptTemplateKey.CHAT_MAIN,
        version: 9,
      },
    });
  });

  test("setActive activates the version and deactivates the others of that key only", async () => {
    const repository = await setup([
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Old", true),
      makeTemplate(EPromptTemplateKey.CHAT_MAIN, 2, "New"),
      makeTemplate(EPromptTemplateKey.THREAD_TITLE, 1, "Title", true),
    ]);
    await repository.setActive({
      key: EPromptTemplateKey.CHAT_MAIN,
      version: 2,
    });
    expect((await repository.loadActive()).map(template => `${template.key}#${template.version}`))
      .toEqual(["CHAT_MAIN#2", "THREAD_TITLE#1"]);
  });

  test("setActive throws a 404 with code 5386034892574 for a version that does not exist", async () => {
    const repository = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1)]);
    await expect(repository.setActive({
      key: EPromptTemplateKey.CHAT_MAIN,
      version: 9,
    })).rejects.toMatchObject({
      code: 5386034892574,
      status: 404,
    });
  });
});
