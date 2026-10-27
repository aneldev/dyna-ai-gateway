import {z} from "zod";
import {dynaError} from "dyna-error";

import {
  EToolCallVerdict,
  IToolDef,
} from "../../contracts";

import {defineTool} from "../tool-registry";

import {
  IUserQuestions,
  EUserQuestionMode,
} from "./types";

/** Name of the built-in user-question tool (D62); the gateway offers it in every run when `humanGate.userQuestions` is enabled. */
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

/**
 * The built-in user-question tool (D62): the model calls it when it cannot proceed without the user. The call never executes:
 * its `policy` is `NEEDS_APPROVAL`, so the loop pauses and `settleRun` turns the input into a CLARIFICATION envelope; the user's
 * answers come back as the tool's result through `resume` with ANSWER.
 */
export const makeAskUserQuestionTool = (): IToolDef<IUserQuestions, never> => defineTool({
  name: ASK_USER_QUESTION_TOOL_NAME,
  description: [
    "Asks the user when the task cannot proceed without their input: a missing value, an ambiguous reference, a choice only they can make.",
    "Put every open question into one call; the user answers them together. Prefer options over free text when the answers are known.",
    "Do not ask what the conversation, the tools or the knowledge base already answer.",
  ].join(" "),
  inputSchema: askUserQuestionInputSchema,
  tags: ["user-question"],
  policy: EToolCallVerdict.NEEDS_APPROVAL,
  execute: async ({input}): Promise<never> => {
    throw dynaError({
      code: 5372634117683,
      status: 500,
      message: `HumanGate: the [${ASK_USER_QUESTION_TOOL_NAME}] tool is never executed, its call pauses the run`,
      data: {title: input.title},
    });
  },
});

/** The tool's input, as the model fills it; the same shape the UI renders (`IUserQuestionEnvelope.userQuestions`). */
export const askUserQuestionInputSchema = z.object({
  title: z.string().describe("Short title of what is missing, in the user's language"),
  description: z.string().optional()
    .describe("Why the answers are needed, one or two sentences"),
  questions: z.array(z.object({
    text: z.string().describe("The question, in the user's language"),
    mode: z.enum(EUserQuestionMode).describe("RADIO = one option, CHECK = several options, FREE_TEXT = the user types the answer"),
    options: z.array(z.string()).optional()
      .describe("The answers to pick from; RADIO and CHECK only"),
    freeOption: z.boolean().optional()
      .describe("True when the user may type an own answer next to the options; RADIO and CHECK only"),
  })).min(1),
});
