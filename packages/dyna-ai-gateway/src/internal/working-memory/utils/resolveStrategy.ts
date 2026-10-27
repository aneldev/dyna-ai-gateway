import {IAIProfile} from "../../ai-profile-store";

import {
  IWorkingMemoryConfig,
  IWorkingMemorySlidingWindow,
  IWorkingMemorySummaryBuffer,
  EWorkingMemoryStrategy,
} from "../types";

const DEFAULT_CHAT_HISTORY_RATIO = 0.8;
const DEFAULT_MAX_LOADED_TURNS = 200;
const DEFAULT_RECENT_TURNS = 20;
const DEFAULT_UPDATE_EVERY_TURNS = 1;
const DEFAULT_MAX_SUMMARY_CHARS = 1500;
const DEFAULT_MAX_FACTS = 30;

/** A strategy with every option filled: what the loaders and the updater work with. */
export type TResolvedStrategy =
  | Required<IWorkingMemorySlidingWindow>
  | Required<IWorkingMemorySummaryBuffer>;

/** The strategy of one call, defaults applied: the profile's `workingMemory`, else the config's `strategy`, else SUMMARY_BUFFER. */
export const resolveStrategy = (
  {
    config,
    profile,
  }: {
    config: IWorkingMemoryConfig;
    profile?: IAIProfile;
  },
): TResolvedStrategy => {
  const strategy = profile?.workingMemory ?? config.strategy ?? {type: EWorkingMemoryStrategy.SUMMARY_BUFFER};
  if (strategy.type === EWorkingMemoryStrategy.SLIDING_WINDOW) {
    return {
      type: EWorkingMemoryStrategy.SLIDING_WINDOW,
      chatHistoryRatio: strategy.chatHistoryRatio ?? DEFAULT_CHAT_HISTORY_RATIO,
      maxLoadedTurns: strategy.maxLoadedTurns ?? DEFAULT_MAX_LOADED_TURNS,
    };
  }
  return {
    type: EWorkingMemoryStrategy.SUMMARY_BUFFER,
    recentTurns: strategy.recentTurns ?? DEFAULT_RECENT_TURNS,
    updateEveryTurns: strategy.updateEveryTurns ?? DEFAULT_UPDATE_EVERY_TURNS,
    maxSummaryChars: strategy.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS,
    maxFacts: strategy.maxFacts ?? DEFAULT_MAX_FACTS,
  };
};
