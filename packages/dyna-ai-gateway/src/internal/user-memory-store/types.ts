import {ITurn} from "../../contracts";

import {IPromptTemplateStore} from "../prompt-template-store";
import {
  ILLMClient,
  ILLMClientCallMeta,
} from "../llm-client";

/** Configuration of the UserMemoryStore. Lands in IAIGatewayConfig.userMemoryStore. */
export interface IUserMemoryStoreConfig {
  /** Persistence; Mongo in v1. */
  repository: IUserMemoryRepository;
  /** The switch of the extraction. Off: nothing is due, the model is never called for it; stored facts are still read and editable. No default. */
  enabled: boolean;
  /** Cap of facts per user. Default 50. */
  maxFacts?: number;
  /**
   * Cap of the characters of a fact's key and of its value. Every fact goes into every prompt of the user, so an unbounded fact
   * costs on every call. A fact set by hand (`upsertFact`, the `remember_user_fact` tool) over the cap is a 400; a fact the
   * extractor writes is cut to it. Default 500.
   */
  maxFactChars?: number;
  /**
   * The model's `remember_user_fact` waits for the user's approval before it stores the fact (D116).
   *
   * > A fact enters every prompt of the user: text the model only read (a tool result, a knowledge-base excerpt, a file) must
   * > not be able to write one unasked.
   *
   * The run pauses with a TOOL_APPROVAL card whose input is the fact (`{key, value}`). Switch it off for an app that accepts
   * the risk and wants "remember this" stored at once. The facts the extractor writes and `upsertUserFact` are not affected;
   * `forget_user_fact` never pauses (it only removes).
   *
   * @default true
   */
  rememberNeedsApproval?: boolean;
  /** Run extraction every time a thread crosses a multiple of N turns (IThread.turnCount). Default 10. */
  extractEveryTurns?: number;
}

/** Shared instances UserMemoryStore needs; created once by AIGateway and passed as the second constructor argument. */
export interface IUserMemoryStoreDeps {
  llmClient: ILLMClient;
  promptTemplateStore: IPromptTemplateStore;
}

/**
 * Cross-thread user facts, extracted by a cheap LLM, editable by the user.
 *
 * Implemented by `UserMemoryStore`; the type of `IAIGatewayDeps.userMemoryStore`, so a host may pass its own in `overrides`.
 */
export interface IUserMemoryStore {
  /** Returns all facts; injected into the system prompt. No LLM. */
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
   * Extracts durable facts from turns and merges them into the stored ones (same key = replace). Cheap LLM.
   * Returns the facts that are stored afterwards. They stay as they are when the extraction is switched off, when there
   * is no turn, when the model call fails or when its answer is not the expected structure.
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
   * Tells the gateway whether extraction is due: after the first answer of a thread (the opening message carries most facts:
   * name, place, language), and then whenever the thread crossed a multiple of extractEveryTurns with its last call.
   * Never due while the extraction is switched off.
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

  /** User or admin sets a fact by hand. Same key = replace. Throws a 400 for an empty key or value, or one over `maxFactChars`. */
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

  /** User deletes one fact. A key that is not there changes nothing. */
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

  /** User deletes everything. */
  clear(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<void>;

  /** Removes the facts of a user and their record (GDPR erasure); `clear` is the user's own "forget my facts". Returns the number of facts removed. */
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

/** Persistence seam. */
export interface IUserMemoryRepository {
  load(args: {
    tenantId: string;
    userId: string;
  }): Promise<IUserMemoryFact[]>;
  saveAll(args: {
    tenantId: string;
    userId: string;
    facts: IUserMemoryFact[];
  }): Promise<void>;
  /** Removes the record of a user (GDPR erasure); nothing is left, not even an empty record. Returns the number of facts removed. */
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
  value: string;
  /** Thread the fact was extracted from; empty when user-entered. */
  sourceThreadId?: string;
  updatedAt: Date;
}
