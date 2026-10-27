import {EIssueSeverity} from "../../../contracts";

import {
  EPauseKind,
  EResumeAction,
} from "../types";
import {makeResultReviewDraft} from "../utils/makeResultReviewDraft";

/** The review envelope (D99) shows the reviewer the answer as the user would get it and offers approve, edit and reject; `structured` is present only when given. */
test("a RESULT_REVIEW draft carries the answer, its citations and warnings, allows APPROVE / EDIT / REJECT, and omits an absent structured", () => {
  const warning = {
    code: "long",
    message: "The answer is long",
    severity: EIssueSeverity.WARNING,
  };
  const plain = makeResultReviewDraft({
    text: "Shipped Monday.",
    citations: ["chunk-1"],
    issues: [warning],
  });
  const structured = makeResultReviewDraft({
    text: "{\"status\":\"shipped\"}",
    structured: {status: "shipped"},
    citations: [],
    issues: [],
  });

  expect([
    plain,
    "structured" in (plain.result ?? {}),
    structured.result?.structured,
  ]).toEqual([
    {
      kind: EPauseKind.RESULT_REVIEW,
      result: {
        text: "Shipped Monday.",
        citations: ["chunk-1"],
        issues: [warning],
      },
      allowed: [EResumeAction.APPROVE, EResumeAction.EDIT, EResumeAction.REJECT],
    },
    false,
    {status: "shipped"},
  ]);
});
