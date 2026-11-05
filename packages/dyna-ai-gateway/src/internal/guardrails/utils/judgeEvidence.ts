import {EPartKind} from "../../../contracts";

import {TMessagePart} from "../../llm-client";

import {
  IInputEvidence,
  IInputJudgeArgs,
  IOutputEvidence,
  IOutputJudgeArgs,
} from "../types";

/**
 * toInputJudgeParts -- the evidence of an input check as message parts
 *
 * # About
 *
 * > The prompt always, the files the rule's filter picks.
 *
 * One text part with the sanitised prompt, then the inline files of `IInputEvidence.inlineFiles` whose `IFileRef` passes the
 * call's `fileFilter` (D59: the rule says which files, never the evidence itself).
 *
 * # Who needs it
 *
 * `Guardrails.checkInput`, as the `toEvidenceParts` of its judge.
 */
export const toInputJudgeParts = (
  {
    evidence: {
      prompt,
      files,
      inlineFiles,
    },
    fileFilter,
  }: {
    evidence: IInputEvidence;
    fileFilter: IInputJudgeArgs["fileFilter"];
  },
): TMessagePart[] => [
  {
    kind: EPartKind.TEXT,
    text: renderSections([["Prompt", prompt]]),
  },
  ...inlineFiles.filter((_, index) => fileFilter(files[index])),
];

/**
 * toOutputJudgeParts -- the evidence of an output check as message parts
 *
 * # About
 *
 * > Question and answer always, the KB chunks and the tool results when the rule switches them on.
 *
 * One text part in sections: the question, the answer (a structured value as pretty JSON), then "Knowledge-base chunks"
 * with every chunk's heading path and text when `withChunks`, and "Tool results" with every result's tool name and output when
 * `withToolResults`; an empty section is left out.
 *
 * # Who needs it
 *
 * `Guardrails.checkOutput`, as the `toEvidenceParts` of its judge.
 */
export const toOutputJudgeParts = (
  {
    evidence: {
      prompt,
      output,
      chunks,
      toolResults,
    },
    withChunks,
    withToolResults,
  }: {
    evidence: IOutputEvidence;
    withChunks: IOutputJudgeArgs["chunks"];
    withToolResults: IOutputJudgeArgs["toolResults"];
  },
): TMessagePart[] => [{
  kind: EPartKind.TEXT,
  text: renderSections([
    ["Question", prompt],
    ["Answer", typeof output === "string" ? output : JSON.stringify(output, null, 2)],
    ["Knowledge-base chunks", withChunks ? chunks.map(chunk => `[${chunk.headingPath}]\n${chunk.text}`).join("\n\n") : ""],
    ["Tool results", withToolResults ? toolResults.map(result => `[${result.toolName}]\n${JSON.stringify(result.output, null, 2)}`).join("\n\n") : ""],
  ]),
}];

/** "Title:\n<text>" blocks, the empty ones left out. */
const renderSections = (sections: [title: string, text: string][]): string => sections
  .filter(([, text]) => text.length > 0)
  .map(([title, text]) => `${title}:\n${text}`)
  .join("\n\n");
