import {
  APICallError,
  RetryError,
} from "ai";

/** What is kept of a provider's error for the logs. */
interface IProviderErrorSummary {
  name: string;
  message: string;
  statusCode?: number;
  url?: string;
  isRetryable?: boolean;
  /** RetryError: why the retries ended. */
  reason?: string;
  /** RetryError: each attempt, summarised the same way. */
  errors?: unknown[];
}

/**
 * A provider's error without the request it carried. The AI SDK's `APICallError` holds `requestBodyValues` (the system prompt,
 * the user's facts, the transcript, base64 files), and a `RetryError` one per attempt: a JSON logger writes them whole. Kept:
 * name, message, status code, url, whether it can be retried. Any other value is returned as it is.
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
