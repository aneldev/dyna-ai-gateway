/** Where the output goes: the terminal (chat, colours) or a dev-tools console (debugger session, objects). */
export enum EDevOutputMode {
  /** `sandbox.cli.sh`: a terminal; colours always (FORCE_COLOR), objects as colourised JSON text. */
  CLI = "CLI",
  /** `sandbox.debug.sh`: the dev-tools console of the inspector; no colours (NO_COLOR), objects as objects (expandable). */
  DEBUG = "DEBUG",
}

const ENV_VAR = "AIGATEWAY_DEV_OUTPUT_MODE";

/**
 * getDevOutputMode -- the output mode of this process
 *
 * # About
 *
 * > `AIGATEWAY_DEV_OUTPUT_MODE`, set by the script that started the entry; `CLI` when not set.
 *
 * Any other value throws with the valid ones named.
 *
 * # Who needs it
 *
 * `createSandboxAIGateway`, once, for the printing trace and the error reports.
 */
export const getDevOutputMode = (): EDevOutputMode => {
  const value = process.env[ENV_VAR];
  if (value === undefined) return EDevOutputMode.CLI;
  if (value === EDevOutputMode.CLI || value === EDevOutputMode.DEBUG) return value;
  throw new Error(`Unknown ${ENV_VAR} "${value}". Valid: ${Object.values(EDevOutputMode).join(" | ")}`);
};
