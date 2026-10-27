import {EPartKind} from "../../../contracts";

import {TMessagePart} from "../../llm-client";

import {
  IInputEvidence,
  IInputJudgeArgs,
  IOutputEvidence,
  IOutputJudgeArgs,
} from "../types";

/** The evidence of an input check as message parts for the judge: the prompt, then the files the call's filter picks. */
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

/** The evidence of an output check as message parts for the judge: question and answer, then what the call switches on. */
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
