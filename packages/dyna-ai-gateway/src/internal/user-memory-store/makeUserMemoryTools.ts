import {z} from "zod";

import {
  IToolDef,
  EToolCallVerdict,
} from "../../contracts";

import {defineTool} from "../tool-registry";

import {IUserMemoryStore} from "./types";

/** Names of the built-in tools of the user memory (D61); the gateway offers them in every run when the memory is enabled. */
export const USER_MEMORY_TOOL_NAMES = {
  REMEMBER: "remember_user_fact",
  FORGET: "forget_user_fact",
} as const;

/**
 * The built-in tools of the user memory (D61): the model stores a fact the moment the user asks ("remember this") or forgets one
 * ("forget my language"), without waiting for the extraction. Both write through the store, like the user's own edits.
 * `remember_user_fact` waits for the user's approval unless `rememberNeedsApproval` is false (D116).
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
    name: USER_MEMORY_TOOL_NAMES.REMEMBER,
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
    name: USER_MEMORY_TOOL_NAMES.FORGET,
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
