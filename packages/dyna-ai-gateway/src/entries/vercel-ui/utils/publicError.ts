import {IDynaError} from "dyna-error";

/** What a client may read of an error: its status, its code, and its message only when the caller caused it (a 4xx). */
export interface IPublicError {
  /** The HTTP status the client gets; 500 for anything outside 400–599. */
  status: number;
  /** The dynaError code, when the error has one. */
  code?: number;
  /** The error's message for a 4xx; the fixed `"Internal error"` otherwise. */
  message: string;
}

/**
 * toPublicError -- the error as the client may see it
 *
 * # About
 *
 * > A 4xx is about the caller's input and passes; anything else is a 500 with a fixed text.
 *
 * Reads `status`, `code` and `message` of a dynaError; a status outside 400–599, or no status, is a 500. The message
 * of a 5xx (a provider failure, a bug) never reaches the browser.
 *
 * # Who needs it
 *
 * `toErrorResponse` for the JSON response before the stream, `streamChunks` of `AIGatewayVercelUi` for the `error`
 * chunk once it runs.
 */
export const toPublicError = ({error}: {error: unknown}): IPublicError => {
  const {
    status,
    code,
    message,
  } = (error ?? {}) as Partial<IDynaError>;
  const publicStatus = typeof status === "number" && status >= 400 && status < 600 ? status : 500;
  return {
    status: publicStatus,
    ...typeof code === "number" ? {code} : {},
    message: publicStatus < 500 && typeof message === "string" ? message : "Internal error",
  };
};

/**
 * toErrorResponse -- the JSON `Response` of an error thrown before the stream started
 *
 * # About
 *
 * > `{code, message}` with the public error's status.
 *
 * # Who needs it
 *
 * `AIGatewayVercelUi.chat` and `resume`, for the 400 of the input, the 404 of a foreign thread or pause, the 409 of a
 * paused thread, the 401 of `userContext`.
 */
export const toErrorResponse = ({error}: {error: unknown}): Response => {
  const publicError = toPublicError({error});
  return new Response(
    JSON.stringify({
      ...publicError.code === undefined ? {} : {code: publicError.code},
      message: publicError.message,
    }),
    {
      status: publicError.status,
      headers: {"content-type": "application/json"},
    },
  );
};
