import {
  IIssue,
  IOutputRule,
  EIssueSeverity,
} from "../../..";

interface ILine {
  amount: number;
}

const TOLERANCE = 0.005;

const isLine = (line: unknown): line is ILine =>
  typeof (line as ILine | null)?.amount === "number";

/**
 * Test output rule: when the output has a numeric `total` and a `lines[]` with numeric `amount`s,
 * the amounts must add up to the total (±0.005). Outputs without both fields pass.
 */
export const sumMatchesTotal: IOutputRule = {
  name: "sum_matches_total",
  check: async ({evidence}): Promise<IIssue[]> => {
    const output = evidence.output as {total?: unknown; lines?: unknown} | null;
    if (typeof output?.total !== "number" || !Array.isArray(output.lines)) return [];

    const sum = output.lines.filter(isLine).reduce((acc, line) => acc + line.amount, 0);
    if (Math.abs(sum - output.total) <= TOLERANCE) return [];
    return [
      {
        code: "sum_mismatch",
        message: `The lines add up to ${sum}, the total says ${output.total}`,
        severity: EIssueSeverity.ERROR,
        field: "total",
      },
    ];
  },
};
