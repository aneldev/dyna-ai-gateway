import {styleText} from "node:util";

import {IRuleErrorReport} from "../..";

import {colorizeJson} from "./colorizeJson";
import {EDevOutputMode} from "./devOutputMode";
import {
  devConsole,
  EDevConsole,
} from "./devConsole";
import {toPrintableError} from "./toPrintableError";

/**
 * printRuleErrorReport -- one failed guardrail rule on the `TRACE` channel
 *
 * # About
 *
 * > What a host wires `onRuleError` to, shown at once in the chat.
 *
 * The label names the rule, the stage and how it failed; the payload is the `IRuleErrorReport` with the error as JSON can
 * show it and the evidence without the file bytes and the profile (its id stays). DEBUG mode prints the report object
 * itself; CLI mode the label and the colourised JSON.
 *
 * # Who needs it
 *
 * `createSandboxAIGateway`, as the `onRuleError` it puts in front of the config's own handler.
 */
export const printRuleErrorReport = (
  {
    report,
    outputMode,
  }: {
    report: IRuleErrorReport;
    outputMode: EDevOutputMode;
  },
): void => {
  const {
    ruleName,
    stage,
    failure,
    durationMs,
  } = report;
  const label = `${styleText("red", "rule error")} ${ruleName} · ${stage} · ${failure} · ${durationMs} ms`;
  if (outputMode === EDevOutputMode.DEBUG) {
    devConsole.log(EDevConsole.TRACE, label, report);
  }
  else {
    devConsole.log(EDevConsole.TRACE, "Label", label);
    devConsole.log(EDevConsole.TRACE, "Payload", colorizeJson({value: toPrintableReport(report)}));
  }
};

/**
 * The report as JSON can show it: the error through `toPrintableError`;
 * the evidence with the inline files as their count and the profile as its id.
 */
const toPrintableReport = (report: IRuleErrorReport): unknown => {
  const {
    profile,
    ...evidence
  } = report.evidence;
  return {
    ...report,
    error: toPrintableError(report.error),
    evidence: {
      ...evidence,
      ..."inlineFiles" in evidence ? {inlineFiles: `<${evidence.inlineFiles.length} files>`} : {},
      profileId: profile.id,
    },
  };
};
