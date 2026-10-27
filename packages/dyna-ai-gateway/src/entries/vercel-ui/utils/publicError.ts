import {IDynaError} from "dyna-error";

/** What a client may read of an error: its status, its code, and its message only when the caller caused it (a 4xx). */
export interface IPublicError {
  status: number;
  code?: number;
  message: string;
}

/**
 * The error as the client gets it: the gateway's 4xx messages are about the caller's input and pass; anything else (a
 * provider failure, a bug) is hidden behind a 500 and a fixed text, so no internal detail reaches the browser.
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

/** A JSON `Response` of the error, with its status, for an error thrown before the stream started. */
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
