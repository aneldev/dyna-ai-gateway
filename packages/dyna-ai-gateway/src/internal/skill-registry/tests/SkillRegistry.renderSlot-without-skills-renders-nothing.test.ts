import {SkillRegistry} from "../SkillRegistry";

/** A call without skills must not get a "Skills" header: the slot is an empty string in both modes. */
test("renderSlot returns an empty string when there are no skills", () => {
  const registry = new SkillRegistry();

  expect([
    registry.renderSlot({
      skills: [],
      inline: false,
    }),
    registry.renderSlot({
      skills: [],
      inline: true,
    }),
  ]).toEqual(["", ""]);
});
