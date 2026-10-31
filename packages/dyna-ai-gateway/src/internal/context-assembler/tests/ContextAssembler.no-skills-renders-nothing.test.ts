import {joinSystem} from "../../llm-client";

import {
  makeAssembler,
  makeInput,
} from "./utils/contextAssemblerFixtures";

/** A call without skills: no "Skills" header, no blank lines left by the empty slot, no issue. */
test("a call without skills renders no skills text and no issue", async () => {
  const {
    request,
    issues,
  } = await makeAssembler().build({input: makeInput()});

  const system = joinSystem({blocks: request.system});
  expect(system).not.toContain("Skills");
  expect(system).not.toContain("\n\n\n");
  expect(issues).toEqual([]);
});
