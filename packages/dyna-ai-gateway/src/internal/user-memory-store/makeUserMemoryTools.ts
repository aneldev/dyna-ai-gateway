import {z} from "zod";

import {
  IToolDef,
  EToolCallVerdict,
  BUILT_IN_TOOL_NAMES,
} from "../../contracts";

import {defineTool} from "../tool-registry";

import {IUserMemoryStore} from "./types";

/**
 * makeUserMemoryTools -- the two built-in tools of the user memory
 *
 * # About
 *
 * > "Remember this" and "forget that", stored the moment the user says it.
 *
 * Builds `dyna_aigw_remember_user_fact` (writes through `upsertFact`) and `dyna_aigw_forget_user_fact` (writes through `removeFact`), tagged
 * `memory`, so the model acts on the user's request at once instead of waiting for the extraction (D61). Both write
 * like the user's own edits, scoped by the call's `userContext`. `dyna_aigw_remember_user_fact` carries `NEEDS_APPROVAL` unless
 * `rememberNeedsApproval` is false, so the run pauses for the user before a fact is stored (D116); `dyna_aigw_forget_user_fact`
 * never pauses.
 *
 * # Who needs it
 *
 * `createGatewayDeps`, when `userMemoryStore.enabled`: the tools go first into the `ToolRegistry` and are offered in
 * every run.
 *
 * # Pitfalls
 *
 * `ask()` has no tools: there "remember this" waits for the extraction. An app tool named like one of these is a
 * duplicate the registry rejects.
 */
export const makeUserMemoryTools = (
  {
    userMemoryStore,
    rememberNeedsApproval,
  }: {
    userMemoryStore: IUserMemoryStore;
    rememberNeedsApproval: boolean;
  },
): IToolDef[] => [
  defineTool({
    name: BUILT_IN_TOOL_NAMES.REMEMBER_USER_FACT,
    description: [
      "Stores a lasting fact about the user for all future conversations: when the user asks to remember something,",
      "or states something lasting about themselves (name, where they live or work, language, role, preferences).",
      "The same key replaces the stored fact. Not for the task at hand, and nothing sensitive: health, religion, political views, passwords, payment data.",
    ].join(" "),
    inputSchema: z.object({
      key: z.string().describe("Short key in English, camelCase, e.g. location, language, role"),
      value: z.string().describe("The fact, in the user's language"),
    }),
    tags: ["memory"],
    // A fact enters every future prompt of the user: an injected instruction must not write one unasked
    policy: rememberNeedsApproval ? EToolCallVerdict.NEEDS_APPROVAL : EToolCallVerdict.ALLOW,
    execute: async ({
      input: {
        key,
        value,
      },
      userContext: {
        tenantId,
        userId,
      },
    }): Promise<{key: string; value: string}> => {
      await userMemoryStore.upsertFact({
        tenantId,
        userId,
        key,
        value,
      });
      return {
        key,
        value,
      };
    },
  }),
  defineTool({
    name: BUILT_IN_TOOL_NAMES.FORGET_USER_FACT,
    description: "Removes a stored fact about the user, when the user asks to forget it or says it no longer holds. The key is one of the known user facts.",
    inputSchema: z.object({key: z.string().describe("The key of the stored fact")}),
    tags: ["memory"],
    execute: async ({
      input: {key},
      userContext: {
        tenantId,
        userId,
      },
    }): Promise<{key: string}> => {
      await userMemoryStore.removeFact({
        tenantId,
        userId,
        key,
      });
      return {key};
    },
  }),
];
