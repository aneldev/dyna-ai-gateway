/** Where the output goes: the terminal (chat, colours) or a dev-tools console (debugger session, objects). */
export enum EDevOutputMode {
  /** `sandbox.cli.sh`: a terminal; colours always (FORCE_COLOR), objects as colourised JSON text. */
  CLI = "CLI",
  /** `sandbox.debug.sh`: the dev-tools console of the inspector; no colours (NO_COLOR), objects as objects (expandable). */
  DEBUG = "DEBUG",
}

const ENV_VAR = "AIGATEWAY_DEV_OUTPUT_MODE";

/** The mode of this process, set by the script that started it (`AIGATEWAY_DEV_OUTPUT_MODE`); CLI when not set. */
export const getDevOutputMode = (): EDevOutputMode => {
  const value = process.env[ENV_VAR];
  if (value === undefined) return EDevOutputMode.CLI;
  if (value === EDevOutputMode.CLI || value === EDevOutputMode.DEBUG) return value;
  throw new Error(`Unknown ${ENV_VAR} "${value}". Valid: ${Object.values(EDevOutputMode).join(" | ")}`);
};
