import {
  ISkill,
  IToolDef,
} from "../../contracts";

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

  /**
   * makeLoadSkillTool -- the built-in `load_skill` tool of one call
   *
   * # About
   *
   * > The model asks for a skill by name and gets its instructions; nothing else can be asked for.
   *
   * The tool's `name` input is an enum of the given skills' names, so the model cannot load a skill the call does not have.
   * `policy` is ALLOW, it never ends the run and is visible on every step; `maxOutputChars` is sized to the longest
   * serialised `{name, body}`, so a long body is never cut by the registry's default. `execute` returns `{name, body}`.
   *
   * # Who needs it
   *
   * The call preparation of a `run()` and of a `resume()`, with the list `resolve` returned, when that list is not empty.
   * An `ask()` never builds it: without tools the bodies are inlined.
   *
   * # Pitfalls
   *
   * An empty list is a 400: the tool must not be offered when there is nothing to load.
   */
  makeLoadSkillTool(args: {
    /** The resolved skills of the call (`resolve`); at least one. */
    skills: ISkill[];
  }): IToolDef<ILoadSkillInput, ILoadSkillResult>;
}

/**
 * The input of the built-in `load_skill` tool, as the model fills it.
 *
 * Parsed by the `ToolRegistry` with the tool's schema, whose `name` is an enum of the call's skills.
 */
export interface ILoadSkillInput {
  /** The name of the skill to load, one of the names listed in the system prompt. */
  name: string;
}

/**
 * The result of the built-in `load_skill` tool: the skill the model asked for.
 *
 * Returned to the model as the tool's result; the `body` is the instructions it then follows.
 */
export interface ILoadSkillResult {
  /** The name the model asked for. */
  name: string;
  /** The full instructions of the skill. */
  body: string;
}
