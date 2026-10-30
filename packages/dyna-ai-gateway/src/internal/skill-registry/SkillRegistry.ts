import {z} from "zod";
import {dynaError} from "dyna-error";

import {
  ISkill,
  IToolDef,
  EToolCallVerdict,
} from "../../contracts";

import {IAIProfile} from "../ai-profile-store";
import {defineTool} from "../tool-registry";

import {LOAD_SKILL_TOOL_NAME} from "./constants";
import {
  ILoadSkillInput,
  ILoadSkillResult,
  ISkillRegistry,
  ISkillRegistryConfig,
} from "./types";

const DEFAULT_MAX_SKILLS = 50;
const DEFAULT_MAX_BODY_CHARS = 50_000;
const SKILLS_LIST_INTRO =
  "Skills — instructions you can load when a task needs them. Call load_skill with the name to read one; do not guess its content.";
const SKILLS_INLINE_INTRO = "Skills — instructions for this call:";
const LOAD_SKILL_DESCRIPTION = [
  "Loads the full instructions of one of the skills listed in the system prompt and returns them as {name, body}.",
  "Call it before acting on a topic a skill covers, and follow the body you get; do not guess what a skill says.",
  "Load only the skill the task needs, once per run.",
].join(" ");

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
 * - `renderSlot` writes the `{skills}` slot of CHAT_MAIN: the list the model loads from with `load_skill`, or the bodies inline.
 * - `makeLoadSkillTool` builds the per-call built-in `load_skill`, whose input names only the skills of the call.
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
 * To read a skill at run time: the model does that through the `load_skill` tool, which `makeLoadSkillTool` builds from the
 * resolved list.
 */
export class SkillRegistry implements ISkillRegistry {
  constructor(private readonly config: ISkillRegistryConfig = {}) {
  }

  /**
   * resolve -- the skills of one call as one list
   *
   * # About
   *
   * > The profile's skills first, then the call's; unique names or nothing.
   *
   * A name that is empty after a trim, or that appears twice among the given skills (within one list or across the two), is a
   * 400 whose `data` names the `duplicates` and counts the `emptyNames`. More skills than `maxSkills` (default 50) is a 400
   * with `data.maxSkills` and `data.count`; a `body` longer than `maxBodyChars` (default 50 000) is a 400 with
   * `data.maxBodyChars`, `data.skill` and `data.length`. Nothing else is changed: the skills come back as given, in order.
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
    const maxSkills = this.config.maxSkills ?? DEFAULT_MAX_SKILLS;
    if (merged.length > maxSkills) {
      throw dynaError({
        code: 5380483215107,
        status: 400,
        message: `SkillRegistry: ${merged.length} skills are more than the ${maxSkills} one call may have (maxSkills)`,
        data: {
          maxSkills,
          count: merged.length,
        },
      });
    }
    const maxBodyChars = this.config.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
    const tooLong = merged.find(skill => skill.body.length > maxBodyChars);
    if (tooLong) {
      throw dynaError({
        code: 5380483215110,
        status: 400,
        message: `SkillRegistry: the body of skill [${tooLong.name}] has ${tooLong.body.length} characters, more than maxBodyChars ${maxBodyChars}`,
        data: {
          maxBodyChars,
          skill: tooLong.name,
          length: tooLong.body.length,
        },
      });
    }
    return merged;
  }

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
  public renderSlot(
    {
      skills,
      inline,
    }: {
      /** The resolved skills of the call (`resolve`), in order. */
      skills: ISkill[];
      /** `true` writes the bodies into the prompt; `false` lists name and description for `load_skill`. */
      inline: boolean;
    },
  ): string {
    if (!skills.length) return "";
    if (!inline) {
      return [
        SKILLS_LIST_INTRO,
        ...skills.map(skill => `- ${skill.name}: ${skill.description}`),
      ].join("\n");
    }
    return [
      SKILLS_INLINE_INTRO,
      ...skills.map(skill => `## ${skill.name}\n\n${skill.body.trim()}`),
    ].join("\n\n");
  }

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
  public makeLoadSkillTool(
    {skills}: {
      /** The resolved skills of the call (`resolve`); at least one. */
      skills: ISkill[];
    },
  ): IToolDef<ILoadSkillInput, ILoadSkillResult> {
    const [first, ...rest] = skills.map(skill => skill.name);
    if (first === undefined) {
      throw dynaError({
        code: 5380231947521,
        status: 400,
        message: `SkillRegistry: the [${LOAD_SKILL_TOOL_NAME}] tool needs at least one skill`,
      });
    }
    const maxOutputChars = Math.max(...skills.map(skill => JSON.stringify(this.toResult(skill)).length));
    return defineTool<ILoadSkillInput, ILoadSkillResult>({
      name: LOAD_SKILL_TOOL_NAME,
      description: LOAD_SKILL_DESCRIPTION,
      inputSchema: z.object({name: z.enum([first, ...rest]).describe("The name of the skill, exactly as listed in the system prompt")}),
      tags: ["skill"],
      policy: EToolCallVerdict.ALLOW,
      maxOutputChars,
      execute: async ({input}): Promise<ILoadSkillResult> => {
        const skill = skills.find(candidate => candidate.name === input.name);
        // The schema refuses an unknown name before execute; this guards the list the closure holds
        if (!skill) {
          throw dynaError({
            code: 5380231947524,
            status: 404,
            message: `SkillRegistry: skill [${input.name}] is not among the skills of this call`,
            userMessage: `There is no skill named [${input.name}] in this call; use one of the names listed in the system prompt.`,
            canRetry: false,
            data: {name: input.name},
          });
        }
        return this.toResult(skill);
      },
    });
  }

  /** The tool's result for a skill: `name` and `body`, nothing else (the description is already in the prompt). */
  private toResult(skill: ISkill): ILoadSkillResult {
    return {
      name: skill.name,
      body: skill.body,
    };
  }
}
