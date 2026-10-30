import {
  makeAssembler,
  makeInput,
  makeMemory,
  makeTemplateStore,
} from "./utils/contextAssemblerFixtures";

/** A stored CHAT_MAIN without `{cacheBreakpoint}` is sent as one block, unmarked, and nothing is reported: the admin chose that template. */
test("a template without the breakpoint sends one unmarked block and no issue", async () => {
  const promptTemplateStore = await makeTemplateStore("{addendum}\n\nToday is {today}.");

  const {
    request,
    issues,
  } = await makeAssembler({}, makeMemory(), promptTemplateStore).build({input: makeInput()});

  expect([request.system, request.cacheTools, issues]).toEqual([
    [{text: "Always mention the invoice number.\n\nToday is Thursday, 2026-10-01."}],
    undefined,
    [],
  ]);
});
