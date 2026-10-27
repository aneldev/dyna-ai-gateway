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
 * Prints one failed guardrail rule on the TRACE channel, as the sandbox's `onRuleError`: the label names the rule, the stage and
 * how it failed, the payload is the report with the error as JSON can show it and the evidence without the file bytes and the
 * profile (the profile's id stays). What a developer wires `onRuleError` to in an app, shown at once in the chat.
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

/** The report as JSON can show it: the error through `toPrintableError`, the evidence without file bytes and profile. */
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
