import {
  ASK_USER_QUESTION_TOOL_NAME,
  USER_MEMORY_TOOL_NAMES,
} from "../internal";
import {IAIGatewayConfig} from "../types";

/**
 * Names of the gateway's own tools for the config: the user-memory tools (D61) and `ask_user_question` (D62), each when its switch is on.
 * Not `load_skill` (D124): it exists per call, built from the call's skills, and is named next to these by the two call sites that build it.
 */
export const getBuiltInToolNames = ({config}: {config: IAIGatewayConfig}): string[] => [
  ...(config.userMemoryStore.enabled ? Object.values(USER_MEMORY_TOOL_NAMES) : []),
  ...(config.humanGate.userQuestions.enabled ? [ASK_USER_QUESTION_TOOL_NAME] : []),
];
