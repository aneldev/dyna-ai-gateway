import {joinSystem} from "../../llm-client";

import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/**
 * `promptCaching: false` sends the prompt as one block with no `cache` mark and no `cacheTools`; its text is what the
 * split prompt reads when its blocks are joined (sharing on, so no tenant-scope line is added): the split changes nothing
 * the model reads.
 */
test("promptCaching off sends one unmarked block whose text equals the joined split prompt", async () => {
  const off = await makeAssembler({promptCaching: false}).build({input: makeInput()});
  const on = await makeAssembler({sharePromptCacheAcrossTenants: true}).build({input: makeInput()});

  expect([
    off.request.system.length,
    off.request.system[0].cache,
    off.request.cacheTools,
    off.request.system[0].text === joinSystem({blocks: on.request.system}),
    off.request.system[0].text.includes("cacheBreakpoint"),
  ]).toEqual([1, undefined, undefined, true, false]);
});
