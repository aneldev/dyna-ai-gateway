import {ITurn} from "../../contracts";

import {IPromptTemplateStore} from "../prompt-template-store";
import {
  ILLMClient,
  ILLMClientCallMeta,
} from "../llm-client";

/** Configuration of the UserMemoryStore. Lands in IAIGatewayConfig.userMemoryStore. */
export interface IUserMemoryStoreConfig {
  /** Persistence of the facts: the host's adapter; `InMemoryUserMemoryRepository` ships with the gateway. */
  repository: IUserMemoryRepository;
  /** The switch of the extraction. Off: nothing is due, the model is never called for it; stored facts are still read and editable. No default. */
  enabled: boolean;
  /**
   * Cap of facts per user; over it, the facts updated longest ago are dropped.
   *
   * @default 50
   */
  maxFacts?: number;
  /**
   * Cap of the characters of a fact's key and of its value. Every fact goes into every prompt of the user, so an unbounded fact
   * costs on every call. A fact set by hand (`upsertFact`, the `dyna_aigw_remember_user_fact` tool) over the cap is a 400; a fact the
   * extractor writes is cut to it.
   *
   * @default 500
   */
  maxFactChars?: number;
  /**
   * The model's `dyna_aigw_remember_user_fact` waits for the user's approval before it stores the fact (D116).
   *
   * > A fact enters every prompt of the user: text the model only read (a tool result, a knowledge-base excerpt, a file) must
   * > not be able to write one unasked.
   *
   * The run pauses with a TOOL_APPROVAL card whose input is the fact (`{key, value}`). Switch it off for an app that accepts
   * the risk and wants "remember this" stored at once. The facts the extractor writes and `upsertUserFact` are not affected;
   * `dyna_aigw_forget_user_fact` never pauses (it only removes).
   *
   * @default true
   */
  rememberNeedsApproval?: boolean;
  /**
   * Run extraction every time a thread crosses a multiple of N turns (`IThread.turnCount`).
   *
   * @default 10
   */
  extractEveryTurns?: number;
}

/** Shared instances UserMemoryStore needs; created once by AIGateway and passed as the second constructor argument. */
export interface IUserMemoryStoreDeps {
  /** The cheap-model call of `extract`. */
  llmClient: ILLMClient;
  /** Renders the MEMORY_USER template of `extract`. */
  promptTemplateStore: IPromptTemplateStore;
}

/**
 * Cross-thread user facts, extracted by a cheap LLM, editable by the user.
 *
 * Implemented by `UserMemoryStore`; the type of `IAIGatewayDeps.userMemoryStore`, so a host may pass its own in `overrides`.
 */
export interface IUserMemoryStore {
  /**
   * getFacts -- the stored facts of one user
   *
   * # About
   *
   * > What every prompt of this user starts with.
   *
   * Reads the facts from the repository, as last saved; [] for a user without a record. No model call, no write.
   *
   * # Who needs it
   *
   * `prepareCall`, once per call, for the `{memory}` slot; `AIGateway.getUserFacts`, for a "what do you know about me" UI.
   */
  getFacts(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<IUserMemoryFact[]>;

  /**
   * extract -- learns durable facts from the newest turns of a thread
   *
   * # About
   *
   * > The cheap model reads the turns and says what to remember and what to forget.
   *
   * Renders the MEMORY_USER template with the known facts, sends `turns` as a plain transcript (`toTranscript`) to the
   * cheap model and merges its operations into the stored facts: `SET` adds or replaces the key (a fact repeated
   * unchanged keeps its date and its source), `DELETE` removes it. The result is saved under the caps and returned.
   *
   * The stored facts stay as they are, and are returned, when the extraction is switched off, when there is no turn,
   * when the model call fails (a refusal of the usage adapter is silent, anything else is reported, error
   * 5372598726156) or when the answer is not the expected structure (error 5372598726369).
   *
   * # Who needs it
   *
   * `updateMemory`, in the background after an answer, when `isExtractDue` says so; it passes the turns since the last
   * extraction.
   *
   * # Pitfalls
   *
   * A model failure never throws; a failing repository does, the caller's background queue catches it. The facts of a
   * run with many tool turns cost one cheap call per `extractEveryTurns` turns, not per answer.
   */
  extract(
    {
      tenantId,
      userId,
      threadId,
      turns,
      cheapModelId,
      meta,
    }: {
      tenantId: string;
      userId: string;
      /** The thread the turns belong to; recorded as the source of the facts. */
      threadId: string;
      turns: ITurn[];
      cheapModelId: string;
      /** For the usage adapter and the trace; kind = MEMORY_USER. */
      meta: ILLMClientCallMeta;
    },
  ): Promise<IUserMemoryFact[]>;

  /**
   * isExtractDue -- whether the thread earned an extraction with its last call
   *
   * # About
   *
   * > Early once, then on a fixed beat.
   *
   * Due after the first answer of a thread (`previousTurnCount` 0, `turnCount` above it: the opening message carries
   * most facts, name, place, language), and then whenever the thread crossed a multiple of `extractEveryTurns` with its
   * last call. Never due while the extraction is switched off. Pure: no read, no write.
   *
   * # Who needs it
   *
   * `updateMemory`, after every answer, before it calls `extract`.
   *
   * # Pitfalls
   *
   * `previousTurnCount` is the count before the whole call, not before its last step: a run adds several turns at once
   * and may jump over a multiple.
   */
  isExtractDue(
    {
      turnCount,
      previousTurnCount,
    }: {
      /** Turns of the thread now. */
      turnCount: number;
      /** Turns of the thread before the call that just ended; a call adds several turns at once. */
      previousTurnCount: number;
    },
  ): boolean;

  /**
   * upsertFact -- the user or an admin sets one fact by hand
   *
   * # About
   *
   * > "Remember that I …", stored at once.
   *
   * Trims the key and the value and stores the fact with no source thread and `updatedAt` now; the same key replaces the
   * stored fact. Throws a 400 for an empty key or value (error 5372597957094) or one over `maxFactChars` (error
   * 5377210486159, with a `userMessage`).
   *
   * # Who needs it
   *
   * `AIGateway.upsertUserFact`, and the `dyna_aigw_remember_user_fact` tool of `makeUserMemoryTools` (after the user's approval,
   * D116).
   *
   * # Pitfalls
   *
   * Over `maxFacts`, the write drops the fact updated longest ago, never the new one.
   */
  upsertFact(
    {
      tenantId,
      userId,
      key,
      value,
    }: {
      tenantId: string;
      userId: string;
      key: string;
      value: string;
    },
  ): Promise<void>;

  /**
   * removeFact -- the user forgets one fact
   *
   * # About
   *
   * > "Forget my language."
   *
   * Removes the fact with `key`; a key that is not there changes nothing and writes nothing.
   *
   * # Who needs it
   *
   * `AIGateway.removeUserFact`, and the `dyna_aigw_forget_user_fact` tool of `makeUserMemoryTools`.
   */
  removeFact(
    {
      tenantId,
      userId,
      key,
    }: {
      tenantId: string;
      userId: string;
      key: string;
    },
  ): Promise<void>;

  /**
   * clear -- the user forgets every fact
   *
   * # About
   *
   * > "Forget everything about me", by the user, for the user.
   *
   * Saves an empty list: the facts go, the user's record stays. The erasure that removes the record is `deleteByUser`.
   *
   * # Who needs it
   *
   * `AIGateway.clearUserFacts`, for a "forget all" action of the UI.
   */
  clear(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<void>;

  /**
   * deleteByUser -- the GDPR erasure of a user's facts
   *
   * # About
   *
   * > Nothing is left, not even an empty record.
   *
   * Removes the facts of the user and their record through the repository and returns the number of facts removed.
   * `clear` is the user's own "forget my facts"; this is the operator's erasure.
   *
   * # Who needs it
   *
   * `forgetUser`, behind `AIGateway.deleteUserData` and `AIGateway.anonymizeUserData`.
   */
  deleteByUser(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<number>;
}

/** Persistence seam of the user facts: one record per tenant + user, implemented by the host's adapter. */
export interface IUserMemoryRepository {
  /**
   * load -- the facts of one user
   *
   * # About
   *
   * > As last saved; `[]` for a user without a record.
   *
   * The user's facts whole, in the order they were saved.
   *
   * # Who needs it
   *
   * `UserMemoryStore.getFacts`.
   */
  load(args: {
    tenantId: string;
    userId: string;
  }): Promise<IUserMemoryFact[]>;
  /**
   * saveAll -- replaces the user's facts
   *
   * # About
   *
   * > The whole list at once; an empty list keeps the record.
   *
   * `clear` saves an empty list; `deleteByUser` removes the record itself.
   *
   * # Who needs it
   *
   * `UserMemoryStore.save`, after an extraction or an edit.
   */
  saveAll(args: {
    tenantId: string;
    userId: string;
    facts: IUserMemoryFact[];
  }): Promise<void>;
  /**
   * deleteByUser -- removes the record of a user
   *
   * # About
   *
   * > GDPR erasure: nothing is left, not even an empty record.
   *
   * Returns the number of facts removed.
   *
   * # Who needs it
   *
   * `UserMemoryStore.deleteByUser`, for the gateway's `deleteUserData`.
   */
  deleteByUser(args: {
    tenantId: string;
    userId: string;
  }): Promise<number>;
}

/** What the extractor may do with one fact. The model returns operations, not a list of facts, so it can forget a fact the user retracted. */
export enum EUserMemoryFactOp {
  /** Add or replace the fact with this key. */
  SET = "SET",
  /** Remove the fact with this key; nothing happens when it is not there. */
  DELETE = "DELETE",
}

/** One durable fact about a user. */
export interface IUserMemoryFact {
  /** Stable key, e.g. "language", "role". */
  key: string;
  /** The fact, in the user's language; at most `maxFactChars`. */
  value: string;
  /** Thread the fact was extracted from; empty when user-entered. */
  sourceThreadId?: string;
  /** When the fact was set or last changed; the oldest go first when `maxFacts` is exceeded. */
  updatedAt: Date;
}
