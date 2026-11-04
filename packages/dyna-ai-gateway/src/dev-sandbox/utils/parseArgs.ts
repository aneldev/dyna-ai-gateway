import {ECLIChatbotMode} from "./runChatSession";

const USAGE = "Usage: ./sandbox.cli.sh <ask|run>";

/** True when `value` is one of the enum's string values; narrows it to the enum type. */
const isEnumValue = <TEnum extends Record<string, string>>(enumObject: TEnum, value: string): value is TEnum[keyof TEnum] =>
  Object.values(enumObject).includes(value);

/**
 * parseArgs -- `<ask|run>` of the sandbox chat
 *
 * # About
 *
 * > One argument, in any case; anything else throws a message that says what to type instead.
 *
 * A missing mode, an unknown one and extra arguments each throw their own message with the usage line and the modes.
 *
 * # Who needs it
 *
 * `sandbox.cli.ts`, first thing.
 */
export const parseArgs = (
  {argv}: {
    /** `process.argv.slice(2)`. */
    argv: string[];
  },
): {mode: ECLIChatbotMode} => {
  const [modeArg, ...extra] = argv;
  const modes = Object.values(ECLIChatbotMode)
    .map(mode => mode.toLowerCase())
    .join(" | ");

  if (modeArg === undefined) throw new Error(`Missing the mode.\n${USAGE}\nMode: ${modes}`);
  const mode = modeArg.toUpperCase();
  if (!isEnumValue(ECLIChatbotMode, mode)) {
    throw new Error(`Unknown mode "${modeArg}". ${USAGE}\nMode: ${modes}\n  ask  AIGateway.ask(): one grounded answer, no tools\n  run  AIGateway.run(): agent run with tools, may pause for approval`);
  }
  if (extra.length) throw new Error(`Unexpected argument(s): ${extra.join(" ")}\n${USAGE}`);
  return {mode};
};
