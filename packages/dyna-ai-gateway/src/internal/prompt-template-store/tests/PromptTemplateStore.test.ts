import {InMemoryPromptTemplateRepository} from "../../../adapters/in-memory";

import {PromptTemplateStore} from "../PromptTemplateStore";
import {
  IPromptTemplate,
  EPromptTemplateKey,
} from "../types";

const makeTemplate = (key: EPromptTemplateKey, version: number, body: string, isActive = true): IPromptTemplate => ({
  key,
  version,
  body,
  isActive,
  updatedAt: new Date(1_000),
});

interface ISetup {
  repository: InMemoryPromptTemplateRepository;
  store: PromptTemplateStore;
}

const setup = async (templates: IPromptTemplate[], cacheTtlMs?: number): Promise<ISetup> => {
  const repository = new InMemoryPromptTemplateRepository();
  for (const template of templates) await repository.save({template});
  return {
    repository,
    store: new PromptTemplateStore({
      repository,
      cacheTtlMs,
    }),
  };
};

const chatMainSlots = {
  today: "2026-09-30",
  locale: "de-AT",
  timezone: "Europe/Vienna",
  addendum: "Tenant text",
  cacheBreakpoint: "",
  instructions: "",
  context: "",
  format: "Format the answer in Markdown.",
  memory: "",
  kb: "",
};

describe("PromptTemplateStore", () => {
  describe("M1", () => {
    test("get returns the active version of the key from the repository", async () => {
      const {store} = await setup([
        makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Old", false),
        makeTemplate(EPromptTemplateKey.CHAT_MAIN, 2, "Active"),
      ]);
      expect(await store.get({key: EPromptTemplateKey.CHAT_MAIN})).toEqual(makeTemplate(EPromptTemplateKey.CHAT_MAIN, 2, "Active"));
    });

    test("get falls back to the shipped seed as version 0 when the repository has no active version", async () => {
      const {store} = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Inactive", false)]);
      const template = await store.get({key: EPromptTemplateKey.CHAT_MAIN});
      expect([template.version, template.isActive, template.body.includes("{addendum}")]).toEqual([0, true, true]);
    });

    test("get serves the host's seedTemplates entry as version 0 and keeps the shipped seed for the other keys", async () => {
      const store = new PromptTemplateStore({
        repository: new InMemoryPromptTemplateRepository(),
        seedTemplates: {[EPromptTemplateKey.CHAT_MAIN]: "Host seed {addendum}"},
      });
      const chatMain = await store.get({key: EPromptTemplateKey.CHAT_MAIN});
      const memoryUser = await store.get({key: EPromptTemplateKey.MEMORY_USER});
      expect([chatMain.version, chatMain.body, memoryUser.version, memoryUser.body.includes("{facts}")])
        .toEqual([0, "Host seed {addendum}", 0, true]);
    });

    test("get prefers the active version of the repository over the host's seedTemplates entry", async () => {
      const repository = new InMemoryPromptTemplateRepository();
      await repository.save({template: makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Active")});
      const store = new PromptTemplateStore({
        repository,
        seedTemplates: {[EPromptTemplateKey.CHAT_MAIN]: "Host seed"},
      });
      expect((await store.get({key: EPromptTemplateKey.CHAT_MAIN})).body).toBe("Active");
    });

    test("get throws a 404 with code 5372567786094 when there is neither an active version nor a seed", async () => {
      const {store} = await setup([]);
      await expect(store.get({key: EPromptTemplateKey.THREAD_TITLE})).rejects.toMatchObject({
        code: 5372567786094,
        status: 404,
        data: {key: EPromptTemplateKey.THREAD_TITLE},
      });
    });

    test("render fills every slot and reports the version used", async () => {
      const {store} = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 3, "Today {today}, twice {today}, tenant: {addendum}")]);
      expect(await store.render({
        key: EPromptTemplateKey.CHAT_MAIN,
        slots: chatMainSlots,
      })).toEqual({
        key: EPromptTemplateKey.CHAT_MAIN,
        version: 3,
        text: "Today 2026-09-30, twice 2026-09-30, tenant: Tenant text",
      });
    });

    test("render renders the seed when the repository is empty", async () => {
      const {store} = await setup([]);
      const {
        version,
        text,
      } = await store.render({
        key: EPromptTemplateKey.CHAT_MAIN,
        slots: chatMainSlots,
      });
      expect([version, text.includes("Today is 2026-09-30"), text.includes("{")]).toEqual([0, true, false]);
    });

    test("render throws a 400 with code 5372567786106 naming the missing slot", async () => {
      const {store} = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Hello {name}")]);
      await expect(store.render({
        key: EPromptTemplateKey.CHAT_MAIN,
        slots: {},
      })).rejects.toMatchObject({
        code: 5372567786106,
        status: 400,
        data: {
          key: EPromptTemplateKey.CHAT_MAIN,
          version: 1,
          slot: "name",
        },
      });
    });

    test("render ignores slot values the template does not use", async () => {
      const {store} = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Plain text")]);
      expect((await store.render({
        key: EPromptTemplateKey.CHAT_MAIN,
        slots: {unused: "value"},
      })).text).toBe("Plain text");
    });

    test("addVersion saves an inactive version numbered after the highest existing one", async () => {
      const {
        repository,
        store,
      } = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 4, "Active")]);
      const added = await store.addVersion({
        key: EPromptTemplateKey.CHAT_MAIN,
        body: "Draft",
      });
      const stored = await repository.get({
        key: EPromptTemplateKey.CHAT_MAIN,
        version: 5,
      });
      expect([added.version, added.isActive, stored?.body]).toEqual([5, false, "Draft"]);
    });

    test("addVersion starts at version 1 when the key has no version yet", async () => {
      const {store} = await setup([]);
      const added = await store.addVersion({
        key: EPromptTemplateKey.THREAD_TITLE,
        body: "Title of: {summary}",
      });
      expect(added.version).toBe(1);
    });

    test("activate makes that version the active one and deactivates the previous", async () => {
      const {store} = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "First")]);
      const added = await store.addVersion({
        key: EPromptTemplateKey.CHAT_MAIN,
        body: "Second",
      });
      await store.activate({
        key: EPromptTemplateKey.CHAT_MAIN,
        version: added.version,
      });
      expect((await store.get({key: EPromptTemplateKey.CHAT_MAIN})).body).toBe("Second");
    });

    test("activate throws a 404 with code 5372567786115 for a version that does not exist", async () => {
      const {store} = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "First")]);
      await expect(store.activate({
        key: EPromptTemplateKey.CHAT_MAIN,
        version: 9,
      })).rejects.toMatchObject({
        code: 5372567786115,
        status: 404,
        data: {
          key: EPromptTemplateKey.CHAT_MAIN,
          version: 9,
        },
      });
    });

    test("get serves from the cache within cacheTtlMs", async () => {
      jest.useFakeTimers();
      const {
        repository,
        store,
      } = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Cached")], 60_000);
      await store.get({key: EPromptTemplateKey.CHAT_MAIN});
      await repository.save({template: makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Changed in the repository")});
      jest.advanceTimersByTime(59_000);
      expect((await store.get({key: EPromptTemplateKey.CHAT_MAIN})).body).toBe("Cached");
      jest.useRealTimers();
    });

    test("get reloads from the repository after cacheTtlMs", async () => {
      jest.useFakeTimers();
      const {
        repository,
        store,
      } = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Cached")], 60_000);
      await store.get({key: EPromptTemplateKey.CHAT_MAIN});
      await repository.save({template: makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Reloaded")});
      jest.advanceTimersByTime(60_000);
      expect((await store.get({key: EPromptTemplateKey.CHAT_MAIN})).body).toBe("Reloaded");
      jest.useRealTimers();
    });
  });

  describe("M6", () => {
    test("listVersions pages the versions of a key newest first, with hasMore", async () => {
      const {store} = await setup([1, 2, 3].map(version => makeTemplate(EPromptTemplateKey.CHAT_MAIN, version, `v${version}`, version === 3)));
      const page = await store.listVersions({
        key: EPromptTemplateKey.CHAT_MAIN,
        page: {
          limit: 2,
          startingAfter: null,
          endingBefore: null,
        },
      });
      expect([page.items.map(template => template.version), page.hasMore]).toEqual([[3, 2], true]);
    });

    test("listVersions throws a 400 with code 5386034892541 for a limit outside 1–200", async () => {
      const {store} = await setup([]);
      await expect(store.listVersions({
        key: EPromptTemplateKey.CHAT_MAIN,
        page: {
          limit: 201,
          startingAfter: null,
          endingBefore: null,
        },
      })).rejects.toMatchObject({
        code: 5386034892541,
        status: 400,
      });
    });

    test("listVersions throws a 400 with code 5386034892552 when both cursors are given", async () => {
      const {store} = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "One")]);
      await expect(store.listVersions({
        key: EPromptTemplateKey.CHAT_MAIN,
        page: {
          limit: 10,
          startingAfter: 1,
          endingBefore: 1,
        },
      })).rejects.toMatchObject({
        code: 5386034892552,
        status: 400,
      });
    });

    test("refresh drops the cache so the next get reads the repository", async () => {
      const {
        repository,
        store,
      } = await setup([makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Cached")], 60_000);
      await store.get({key: EPromptTemplateKey.CHAT_MAIN});
      await repository.save({template: makeTemplate(EPromptTemplateKey.CHAT_MAIN, 1, "Refreshed")});
      await store.refresh();
      expect((await store.get({key: EPromptTemplateKey.CHAT_MAIN})).body).toBe("Refreshed");
    });
  });
});
