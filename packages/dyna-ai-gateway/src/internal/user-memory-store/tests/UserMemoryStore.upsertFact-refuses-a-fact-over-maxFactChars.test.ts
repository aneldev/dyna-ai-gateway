import {
  InMemoryPromptTemplateRepository,
  InMemoryUserMemoryRepository,
} from "../../../adapters/in-memory";

import {FakeLLMClient} from "../../../tests/internal/fakes/FakeLLMClient";

import {PromptTemplateStore} from "../../prompt-template-store";

import {UserMemoryStore} from "../UserMemoryStore";

/** Every fact goes into every prompt of the user: one set by hand over `maxFactChars` is a 400, one at the cap is stored. */
test("upsertFact refuses a value one char over maxFactChars and stores one at the cap", async () => {
  const store = new UserMemoryStore({
    repository: new InMemoryUserMemoryRepository(),
    enabled: false,
    maxFactChars: 20,
  }, {
    llmClient: new FakeLLMClient(),
    promptTemplateStore: new PromptTemplateStore({repository: new InMemoryPromptTemplateRepository()}),
  });
  const owner = {
    tenantId: "tenant-a",
    userId: "user-a",
  };

  const tooLong = store.upsertFact({
    ...owner,
    key: "note",
    value: "x".repeat(21),
  });
  await expect(tooLong).rejects.toMatchObject({
    code: 5377210486159,
    status: 400,
    data: {
      key: "note",
      length: 21,
      maxFactChars: 20,
    },
  });
  await store.upsertFact({
    ...owner,
    key: "note",
    value: "x".repeat(20),
  });

  const facts = await store.getFacts(owner);
  expect(facts.map(fact => fact.value)).toEqual(["x".repeat(20)]);
});
