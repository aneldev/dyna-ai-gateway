import {ISkill} from "../../../../contracts";
import {sampleProfile} from "../../../../tests/internal/samples/profiles";

import {IAIProfile} from "../../../ai-profile-store";

/** A skill named `name`, with a description and a body derived from it. */
export const makeSkill = (name: string, overrides: Partial<ISkill> = {}): ISkill => ({
  name,
  description: `What ${name} covers`,
  body: `# ${name}\n\nThe instructions of ${name}.`,
  ...overrides,
});

/** The sample profile carrying `skills`; no `skills` key at all when none are given, as a stored profile without them. */
export const makeProfileWithSkills = (skills?: ISkill[]): IAIProfile => ({
  ...sampleProfile,
  ...(skills ? {skills} : {}),
});
