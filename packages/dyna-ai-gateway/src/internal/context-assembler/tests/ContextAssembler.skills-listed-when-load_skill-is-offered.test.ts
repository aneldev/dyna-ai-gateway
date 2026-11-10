import {BUILT_IN_TOOL_NAMES} from "../../../contracts";
import {getCurrentTimeTool} from "../../../tests/internal/samples/tools";

import {joinSystem} from "../../llm-client";

import {makeSkill} from "../../skill-registry/tests/utils/skillFixtures";

import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/** With `dyna_aigw_load_skill` among the tools the model can read a body on demand, so the prompt lists the skills and keeps the bodies out. */
test("skills are listed by name and description when dyna_aigw_load_skill is among the tools", async () => {
  const {request} = await makeAssembler().build({
    input: makeInput({
      skills: [makeSkill("refund_policy")],
      // Any tool of that name stands for the built-in: the assembler reads only the name
      tools: [
        {
          ...getCurrentTimeTool,
          name: BUILT_IN_TOOL_NAMES.LOAD_SKILL,
        },
      ],
    }),
  });

  const system = joinSystem({blocks: request.system});
  expect(system).toContain("Call dyna_aigw_load_skill with the name to read one");
  expect(system).toContain("- refund_policy: What refund_policy covers");
  expect(system).not.toContain("The instructions of refund_policy");
});
