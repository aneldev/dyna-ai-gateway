import {
  ASK_USER_QUESTION_TOOL_NAME,
  USER_MEMORY_TOOL_NAMES,
} from "../internal";
import {IAIGatewayConfig} from "../types";

/** Names of the gateway's own tools for the config: the user-memory tools (D61) and `ask_user_question` (D62), each when its switch is on. */
export const getBuiltInToolNames = ({config}: {config: IAIGatewayConfig}): string[] => [
  ...(config.userMemoryStore.enabled ? Object.values(USER_MEMORY_TOOL_NAMES) : []),
  ...(config.humanGate.userQuestions.enabled ? [ASK_USER_QUESTION_TOOL_NAME] : []),
];
