import {ISkill} from "../../contracts";

import {IAIProfile} from "../ai-profile-store";

/**
 * Configuration of the SkillRegistry. Lands in `IAIGatewayConfig.skillRegistry`.
 *
 * The skills themselves are never configured here: they come with the profile (`IAIProfile.skills`) and with the call
 * (`IGatewayAskInput.skills`). This holds only what the gateway applies to all of them.
 */
export interface ISkillRegistryConfig {
}

/**
 * The skills of a call: the merged list of the profile's and the call's skills, validated.
 *
 * Implemented by `SkillRegistry`; the type of `IAIGatewayDeps.skillRegistry`, so a host may pass its own in `overrides`.
 * Asked by `AIProfileStore.upsertProfile` (the profile alone) and by the call preparation (the profile and the call).
 */
export interface ISkillRegistry {
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
  resolve(args: {
    /** The profile of the call; its `skills` come first. */
    profile: IAIProfile;
    /** The call's skills (`IGatewayAskInput.skills`), appended after the profile's. */
    skills?: ISkill[];
  }): ISkill[];

  /**
   * renderSlot -- the text of the `{skills}` slot of CHAT_MAIN
   *
   * # About
   *
   * > Listed when the model can load them, written out when it cannot.
   *
   * `inline: false` (a `run()`, the `load_skill` tool is offered): a header that tells the model to call `load_skill` and
   * one `- name: description` line per skill, so the bodies cost nothing until a task needs one. `inline: true` (an `ask()`,
   * no tools): the header "Skills — instructions for this call:" and every skill as a `## name` section with its body.
   * No skills: an empty string, the slot renders to nothing.
   *
   * # Who needs it
   *
   * `ContextAssembler.build`, with the resolved list of the call and whether `load_skill` is among the call's tools.
   */
  renderSlot(args: {
    /** The resolved skills of the call (`resolve`), in order. */
    skills: ISkill[];
    /** `true` writes the bodies into the prompt; `false` lists name and description for `load_skill`. */
    inline: boolean;
  }): string;
}
