import {
  APICallError,
  RetryError,
} from "ai";

/** What is kept of a provider's error for the logs. */
interface IProviderErrorSummary {
  /** The SDK error's class name. */
  name: string;
  /** The provider's message. */
  message: string;
  /** APICallError: the HTTP status the provider answered with. */
  statusCode?: number;
  /** APICallError: the endpoint called. */
  url?: string;
  /** APICallError: whether the SDK would retry it. */
  isRetryable?: boolean;
  /** RetryError: why the retries ended. */
  reason?: string;
  /** RetryError: each attempt, summarised the same way. */
  errors?: unknown[];
}

/**
 * withoutRequestBody -- a provider's error without the request it carried
 *
 * # About
 *
 * > A logger that writes the error whole must not write the prompt.
 *
 * The AI SDK's `APICallError` holds `requestBodyValues` (the system prompt, the user's facts, the transcript, base64 files),
 * and a `RetryError` one such error per attempt. Kept: name, message, status code, url, whether it can be retried; a
 * `RetryError` keeps its reason and its attempts summarised the same way. Any other value is returned as it is.
 *
 * # Who needs it
 *
 * `LLMClient.toProviderError`, for the `parentError` of the 502.
 */
export const withoutRequestBody = (error: unknown): unknown => {
  if (APICallError.isInstance(error)) {
    const summary: IProviderErrorSummary = {
      name: error.name,
      message: error.message,
      statusCode: error.statusCode,
      url: error.url,
      isRetryable: error.isRetryable,
    };
    return summary;
  }
  if (RetryError.isInstance(error)) {
    const summary: IProviderErrorSummary = {
      name: error.name,
      message: error.message,
      reason: error.reason,
      errors: error.errors.map(withoutRequestBody),
    };
    return summary;
  }
  return error;
};
