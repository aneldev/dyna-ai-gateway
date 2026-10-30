import {dynaError} from "dyna-error";

import {ISkill} from "../../contracts";

import {IAIProfile} from "../ai-profile-store";

import {
  ISkillRegistry,
  ISkillRegistryConfig,
} from "./types";

/**
 * SkillRegistry -- the skills of a call, from the profile's and the call's lists to what the model gets
 *
 * # About
 *
 * > A profile and a call each bring skills; the gateway needs one list it can trust.
 *
 * Skills are instructions the model loads when a task needs them (D124): `ISkill {name, description, body}`, attached to a
 * profile or to one call. This class owns everything the gateway does with them that is not a store's or the assembler's job:
 *
 * - `resolve` merges the two lists and refuses duplicate or empty names, so the model never sees two skills of one name.
 *
 * It sits between the stores and the call: `AIProfileStore` asks it when a profile is saved, the call preparation asks it
 * before the system prompt is rendered and the tools are resolved. It holds no state beyond its config.
 *
 * # Who needs it
 *
 * `AIProfileStore.upsertProfile` (the profile alone) and the call preparation of `ask()`, `run()` and `resume()` (the profile
 * and the call's skills together).
 *
 * # Usage
 *
 * ## When to use it
 *
 * Whenever a list of skills enters the gateway: a profile is written, a call is prepared.
 *
 * ## When shouldn't use it
 *
 * To read a skill at run time: the model does that through the `load_skill` tool, which is built from the resolved list.
 */
export class SkillRegistry implements ISkillRegistry {
  constructor(protected readonly config: ISkillRegistryConfig) {
  }

  /**
   * resolve -- the skills of one call as one list
   *
   * # About
   *
   * > The profile's skills first, then the call's; unique names or nothing.
   *
   * A name that is empty after a trim, or that appears twice among the given skills (within one list or across the two), is a
   * 400 whose `data` names the `duplicates` and counts the `emptyNames`. Nothing else is changed: the skills come back as
   * given, in order.
   *
   * # Who needs it
   *
   * `AIProfileStore.upsertProfile` with the profile alone, so a profile with a duplicate is never stored; the call preparation
   * of `ask()`, `run()` and `resume()` with the profile and the call's skills, before anything of the call is stored.
   */
  public resolve(
    {
      profile,
      skills = [],
    }: {
      /** The profile of the call; its `skills` come first. */
      profile: IAIProfile;
      /** The call's skills (`IGatewayAskInput.skills`), appended after the profile's. */
      skills?: ISkill[];
    },
  ): ISkill[] {
    const merged = [
      ...(profile.skills ?? []),
      ...skills,
    ];
    const emptyNames = merged.filter(skill => skill.name.trim() === "").length;
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const {name} of merged) {
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
    }
    if (emptyNames > 0 || duplicates.length > 0) {
      throw dynaError({
        code: 5380126731579,
        status: 400,
        message: `SkillRegistry: the skills must have unique, non-empty names; duplicates: [${duplicates.join(", ")}], empty names: ${emptyNames}`,
        data: {
          duplicates,
          emptyNames,
        },
      });
    }
    return merged;
  }
}
