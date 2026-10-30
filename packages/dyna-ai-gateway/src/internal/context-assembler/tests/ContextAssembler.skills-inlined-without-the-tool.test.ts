import {joinSystem} from "../../llm-client";

import {makeSkill} from "../../skill-registry/tests/utils/skillFixtures";

import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/** Without `load_skill` (an ask: no tools) the model cannot load anything, so every skill goes into the prompt whole. */
test("skills are written out in full when load_skill is not among the tools", async () => {
  const {request} = await makeAssembler().build({
    input: makeInput({
      skills: [makeSkill("refund_policy")],
      tools: [],
    }),
  });

  const system = joinSystem({blocks: request.system});
  expect(system).toContain("Skills — instructions for this call:");
  expect(system).toContain("## refund_policy\n\n# refund_policy\n\nThe instructions of refund_policy.");
  expect(system).not.toContain("load_skill");
});
