import {
  dynaError,
  IDynaError,
} from "dyna-error";

import {
  IUsageCheckResult,
  IUsageDeniedErrorData,
  USAGE_DENIED_ERROR_CODE,
} from "./types";

/**
 * makeUsageDeniedError -- the error a model call is refused with when the app said no
 *
 * # About
 *
 * > The app's no, as a throw the layers above recognise.
 *
 * A `dynaError` with `USAGE_DENIED_ERROR_CODE` and status 429: `userMessage` is the app's `denyUserMessage`, `data` carries the
 * `traceId` of the refused call and the app's `denyCode`. The developer message names the tenant and the call; it never carries
 * the user's text.
 *
 * # Who needs it
 *
 * The `LLMClient`, when `UsageGuard.check` returns `approved: false`. The orchestration recognises it with `isUsageDeniedError`
 * and turns it into the issue `usage_denied`.
 */
export const makeUsageDeniedError = (
  {
    traceId,
    tenantId,
    result,
  }: {
    traceId: string;
    tenantId: string;
    /** The adapter's answer, `approved: false`. */
    result: IUsageCheckResult;
  },
): IDynaError => {
  const data: IUsageDeniedErrorData = {
    traceId,
    denyCode: result.denyCode,
    denyUserMessage: result.denyUserMessage,
  };
  return dynaError({
    code: USAGE_DENIED_ERROR_CODE,
    status: 429,
    message: `UsageGuard: the usage adapter refused the model call [${traceId}] of tenant [${tenantId}]${result.denyCode ? ` (${result.denyCode})` : ""}`,
    userMessage: result.denyUserMessage,
    data,
  });
};

/** True for the error `makeUsageDeniedError` built: a `dynaError` whose code is `USAGE_DENIED_ERROR_CODE`. */
export const isUsageDeniedError = (error: unknown): error is IDynaError & {data: IUsageDeniedErrorData} =>
  typeof error === "object" && error !== null && (error as IDynaError).code === USAGE_DENIED_ERROR_CODE;
