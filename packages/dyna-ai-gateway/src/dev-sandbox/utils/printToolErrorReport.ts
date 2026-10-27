import {styleText} from "node:util";

import {IToolErrorReport} from "../..";

import {colorizeJson} from "./colorizeJson";
import {EDevOutputMode} from "./devOutputMode";
import {
  devConsole,
  EDevConsole,
} from "./devConsole";
import {toPrintableError} from "./toPrintableError";

/**
 * Prints one failed tool call on the TRACE channel, as the sandbox's `onToolError`: the label names the tool, the code and the
 * status, the payload is the report with the error as JSON can show it (a `dynaError` through its `toJSON`, anything else its
 * message). What a developer wires `onToolError` to in an app, shown at once in the chat.
 */
export const printToolErrorReport = (
  {
    report,
    outputMode,
  }: {
    report: IToolErrorReport;
    outputMode: EDevOutputMode;
  },
): void => {
  const {
    toolName,
    error,
    callId,
    stepIndex,
    durationMs,
  } = report;
  const {
    code,
    status,
  } = error as {code?: number; status?: number};
  const label = `${styleText("red", "tool error")} ${toolName} · code ${code ?? "-"} · status ${status ?? "-"} · step ${stepIndex} · call ${callId} · ${durationMs} ms`;
  if (outputMode === EDevOutputMode.DEBUG) {
    devConsole.log(EDevConsole.TRACE, label, report);
  }
  else {
    devConsole.log(EDevConsole.TRACE, "Label", label);
    devConsole.log(EDevConsole.TRACE, "Payload", colorizeJson({value: toPrintableReport(report)}));
  }
};

/** The report as JSON can show it: the error through `toPrintableError`. */
const toPrintableReport = (report: IToolErrorReport): unknown => ({
  ...report,
  error: toPrintableError(report.error),
});
