import {ECLIChatbotMode} from "./runChatSession";

const USAGE = "Usage: ./sandbox.cli.sh <ask|run>";

const isEnumValue = <TEnum extends Record<string, string>>(enumObject: TEnum, value: string): value is TEnum[keyof TEnum] =>
  Object.values(enumObject).includes(value);

/** `<ask|run>` of the sandbox chat, in any case; throws a message that says what is wrong and what to type instead. */
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
