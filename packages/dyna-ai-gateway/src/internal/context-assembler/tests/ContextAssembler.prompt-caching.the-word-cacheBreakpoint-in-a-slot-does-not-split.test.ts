import {
  makeAssembler,
  makeInput,
  makeMemory,
  makeTemplateStore,
} from "./utils/contextAssemblerFixtures";

/**
 * The sentinel rendered into `{cacheBreakpoint}` is fenced with a private-use character: an addendum (or any slot text) that
 * contains the plain word `cacheBreakpoint` stays whole in the stable block, and the split happens only at the placeholder.
 */
test("the word cacheBreakpoint in a slot text does not split the prompt", async () => {
  const promptTemplateStore = await makeTemplateStore("{addendum}\n\n{cacheBreakpoint}\n\nToday is {today}.");
  const input = makeInput();
  input.profile.promptAddendum = "Explain what cacheBreakpoint means when asked.";

  const {request} = await makeAssembler({}, makeMemory(), promptTemplateStore).build({input});

  expect(request.system).toEqual([
    {
      text: "[cache scope 80a707af7dc7]\n\nExplain what cacheBreakpoint means when asked.",
      cache: true,
    },
    {text: "Today is Thursday, 2026-10-01."},
  ]);
});
