import {SkillRegistry} from "../SkillRegistry";

/** A tool whose enum would be empty cannot be offered: the caller must not build it when the call has no skills. */
test("makeLoadSkillTool refuses an empty skill list with a 400", () => {
  expect(() => new SkillRegistry().makeLoadSkillTool({skills: []})).toThrow(expect.objectContaining({
    code: 5380231947521,
    status: 400,
  }));
});
