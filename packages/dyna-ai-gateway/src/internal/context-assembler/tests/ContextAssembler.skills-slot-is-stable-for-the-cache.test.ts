import {makeSkill} from "../../skill-registry/tests/utils/skillFixtures";

import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/**
 * `{skills}` sits before `{cacheBreakpoint}` in the seed: a profile's skills are the same on every call, so they belong to the
 * cached block. The slot is a stable one: no `prompt_cache_off`, and the skills text is inside the block marked `cache`.
 */
test("the skills slot is stable: it is in the cached block and does not switch the cache off", async () => {
  const {
    request,
    issues,
  } = await makeAssembler().build({input: makeInput({skills: [makeSkill("refund_policy")]})});

  const [stable] = request.system;
  expect(stable?.cache).toBe(true);
  expect(stable?.text).toContain("## refund_policy");
  expect(issues).toEqual([]);
});
