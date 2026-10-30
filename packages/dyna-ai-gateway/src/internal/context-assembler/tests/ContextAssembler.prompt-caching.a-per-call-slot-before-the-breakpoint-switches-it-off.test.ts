import {EIssueSeverity} from "../../../contracts";

import {
  makeAssembler,
  makeInput,
  makeMemory,
  makeTemplateStore,
} from "./utils/contextAssemblerFixtures";

/**
 * A stored CHAT_MAIN with a per-call slot before `{cacheBreakpoint}` would cache text that changes on every call: the prompt
 * is sent as one unmarked block and the call carries the WARNING `prompt_cache_off`, naming the slot, so the admin can fix
 * the template.
 */
test("a per-call slot before the breakpoint sends one block and reports prompt_cache_off", async () => {
  const promptTemplateStore = await makeTemplateStore("Today is {today}.\n\n{addendum}\n\n{cacheBreakpoint}\n\n{instructions}");

  const {
    request,
    issues,
  } = await makeAssembler({}, makeMemory(), promptTemplateStore).build({input: makeInput()});

  expect([
    request.system,
    issues.map(issue => [issue.code, issue.severity, issue.message.includes("[today]")]),
  ]).toEqual([
    [{text: "Today is Thursday, 2026-10-01.\n\nAlways mention the invoice number."}],
    [["prompt_cache_off", EIssueSeverity.WARNING, true]],
  ]);
});
