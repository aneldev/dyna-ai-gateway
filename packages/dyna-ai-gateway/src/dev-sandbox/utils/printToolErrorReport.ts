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
 * printToolErrorReport -- one failed tool call on the `TRACE` channel
 *
 * # About
 *
 * > What a host wires `onToolError` to, shown at once in the chat.
 *
 * The label names the tool, the error's code and status, the step, the call and the duration; the payload is the
 * `IToolErrorReport` with the error as JSON can show it (a `dynaError` through its `toJSON`, anything else its message).
 * DEBUG mode prints the report object itself; CLI mode the label and the colourised JSON.
 *
 * # Who needs it
 *
 * `createSandboxAIGateway`, as the `onToolError` it puts in front of the config's own handler.
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
