import {
  IAIGatewayConfig,
  InMemoryUserMemoryRepository,
} from "../..";

import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The user-memory repository of the config, exported so a test can read the facts the extraction stored. */
export const memoryUserMemoryRepository = new InMemoryUserMemoryRepository();

/**
 * Memory on OpenAI: the thread's working memory (summary + facts) is updated after every answer, and the user's facts are extracted
 * every 2 turns, i.e. after the first answer of a thread. Both are written by the same model, in the background (`whenIdle()`).
 */
export const gatewayConfigMemory: IAIGatewayConfig = {
  ...gatewayConfigBase,
  workingMemory: {enabled: true},
  userMemoryStore: {
    repository: memoryUserMemoryRepository,
    enabled: true,
    extractEveryTurns: 2,
  },
};
