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

/** A prompt over `maxPromptChars` characters is rejected (`prompt_too_long`). */
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

/** A prompt that matches an `INJECTION_PATTERNS` marker is rejected (`prompt_blocked`). */
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

/**
 * createBuiltInInputRules -- the input rules the gateway always runs
 *
 * # About
 *
 * > Code, not configuration: three rules, in this order, before the app's.
 *
 * `prompt_not_empty`, `prompt_max_length` with the config's `maxPromptChars`, `prompt_injection` with the markers of
 * `INJECTION_PATTERNS`. None of them asks a judge: they are cheap by design, a model call here would slow and cost every call.
 *
 * # Who needs it
 *
 * The `Guardrails` constructor, once.
 */
export const createBuiltInInputRules = (
  {maxPromptChars}: {maxPromptChars: number},
): IInputRule[] => [
  promptNotEmpty,
  createPromptMaxLength(maxPromptChars),
  promptInjection,
];
