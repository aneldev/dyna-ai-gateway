import {
  IIssue,
  EIssueSeverity,
} from "../../../contracts";

import {IInputRule} from "../types";

/** Prompt-injection markers. A cheap first filter, not a defence on its own. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts|rules)/i,
  /disregard (all |any )?(previous|prior|above|earlier) (instructions|prompts|rules)/i,
  /you are now in developer mode/i,
];

// WARNING: Do not use judge() here, will make all calls slow and token greedy. Judge() should be uses only by the application!

/** A blank prompt is rejected unless files come with it. */
const promptNotEmpty: IInputRule = {
  name: "prompt_not_empty",
  check: async ({evidence}): Promise<IIssue[]> =>
    evidence.prompt || evidence.files.length > 0
      ? []
      : [
        {
          code: "prompt_empty",
          message: "The prompt is empty",
          severity: EIssueSeverity.ERROR,
          field: "prompt",
        },
      ],
};

const createPromptMaxLength = (maxPromptChars: number): IInputRule => ({
  name: "prompt_max_length",
  check: async ({evidence}): Promise<IIssue[]> =>
    evidence.prompt.length <= maxPromptChars
      ? []
      : [
        {
          code: "prompt_too_long",
          message: `The prompt has ${evidence.prompt.length} characters; the limit is ${maxPromptChars}`,
          severity: EIssueSeverity.ERROR,
          field: "prompt",
        },
      ],
});

const promptInjection: IInputRule = {
  name: "prompt_injection",
  check: async ({evidence}): Promise<IIssue[]> => {
    const matched = INJECTION_PATTERNS.find(pattern => pattern.test(evidence.prompt));
    return matched === undefined
      ? []
      : [
        {
          code: "prompt_blocked",
          message: `The prompt matches a blocked pattern [${matched.source}]`,
          severity: EIssueSeverity.ERROR,
          field: "prompt",
        },
      ];
  },
};

/** The input rules the gateway always runs, before the app's. */
export const createBuiltInInputRules = (
  {maxPromptChars}: {maxPromptChars: number},
): IInputRule[] => [
  promptNotEmpty,
  createPromptMaxLength(maxPromptChars),
  promptInjection,
];
