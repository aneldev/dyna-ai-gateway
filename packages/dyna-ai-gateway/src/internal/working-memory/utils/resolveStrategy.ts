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

/**
 * resolveStrategy -- the strategy of one call, every option filled
 *
 * # About
 *
 * > Profile first, then the gateway's default, then `SUMMARY_BUFFER`.
 *
 * Takes the profile's `workingMemory`, else the config's `strategy`, else `{type: SUMMARY_BUFFER}`, and fills the
 * options it leaves out with the defaults: `chatHistoryRatio` 0.8 and `maxLoadedTurns` 200 for the sliding window;
 * `recentTurns` 20, `updateEveryTurns` 1, `maxSummaryChars` 1500 and `maxFacts` 30 for the summary buffer.
 *
 * # Who needs it
 *
 * `WorkingMemory.load` and `WorkingMemory.saveContext`, once per call.
 *
 * # Pitfalls
 *
 * The profile's strategy replaces the config's as a whole, the options are not merged: a profile with
 * `{type: SUMMARY_BUFFER}` gets the defaults, not the `recentTurns` of the gateway's config.
 */
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
