import {
  ASK_USER_QUESTION_TOOL_NAME,
  USER_MEMORY_TOOL_NAMES,
} from "../internal";
import {IAIGatewayConfig} from "../types";

/**
 * getBuiltInToolNames -- the names of the gateway's own registered tools, as the config enables them
 *
 * # About
 *
 * > The user-memory tools (D61) and `ask_user_question` (D62), each when its switch is on.
 *
 * `ToolPolicy.resolve` offers these outside `activeTools`: a profile cannot hide them and a call cannot name them. Not
 * `load_skill` (D124): it exists per call, built from the call's skills, and the two call sites that build it name it next
 * to these.
 *
 * # Who needs it
 *
 * `prepareCall` (a fresh run) and `AIGateway.continueRun` (a resume), for `builtInTools` of `ToolPolicy.resolve`.
 */
export const getBuiltInToolNames = ({config}: {config: IAIGatewayConfig}): string[] => [
  ...(config.userMemoryStore.enabled ? Object.values(USER_MEMORY_TOOL_NAMES) : []),
  ...(config.humanGate.userQuestions.enabled ? [ASK_USER_QUESTION_TOOL_NAME] : []),
];
