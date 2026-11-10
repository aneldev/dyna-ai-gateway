import {z} from "zod";
import {dynaError} from "dyna-error";

import {
  ITurn,
  EPartKind,
} from "../../contracts";
import {
  devConsole,
  EDevConsole,
} from "../../dev-sandbox/utils/devConsole";

import {
  ILLMClientCallMeta,
  IModelResult,
  EMessageRole,
} from "../llm-client";
import {EPromptTemplateKey} from "../prompt-template-store";
import {toTranscript} from "../turn-builder";
import {isUsageDeniedError} from "../usage-guard";

import {
  IUserMemoryFact,
  IUserMemoryStore,
  IUserMemoryStoreConfig,
  IUserMemoryStoreDeps,
  EUserMemoryFactOp,
} from "./types";

const DEFAULT_MAX_FACTS = 50;
const DEFAULT_MAX_FACT_CHARS = 500;
const DEFAULT_EXTRACT_EVERY_TURNS = 10;
/** Room of one fact (key, value, op) in the answer, for the output limit of the call. */
const FACT_TOKENS = 60;
const NOTHING = "(nothing yet)";

/**
 * What the model returns: operations on facts. A list, not a record: providers with strict structured output do not accept open-ended objects.
 * `op` is required, not optional with a default: strict structured output (OpenAI) wants every property required.
 */
const factsSchema = z.object({
  facts: z.array(z.object({
    key: z.string(),
    /**
     * The field is always present (strict structured output); ignored on DELETE,
     * where the model sends "". Deletion is decided by `op` only.
     */
    value: z.string(),
    op: z.enum(EUserMemoryFactOp),
  })),
});

/**
 * UserMemoryStore -- what the gateway knows about a user across threads
 *
 * # About
 *
 * > The user says it once; every later thread knows it.
 *
 * Implements `IUserMemoryStore`: durable key/value facts about a user (`language`, `role`, `location`), scoped by tenant
 * + user, kept in the host's `IUserMemoryRepository`.
 *
 * - `getFacts` reads them for every call; they go into the `{memory}` slot of the system prompt.
 * - `extract` has the cheap model read the newest turns of a thread and answer with operations (`SET`, `DELETE`) that
 *   are merged into the stored facts; `isExtractDue` says when (after the first answer of a thread, then whenever the
 *   thread crosses a multiple of `extractEveryTurns`).
 * - `upsertFact`, `removeFact`, `clear` are the user's own edits; the model reaches the first two through the built-in
 *   tools of `makeUserMemoryTools`.
 * - `deleteByUser` is the GDPR erasure: the record goes, not only the facts.
 *
 * The caps hold on every write: at most `maxFacts` facts (the ones updated longest ago are dropped), at most
 * `maxFactChars` per key and value (a fact set by hand over it is a 400, an extracted one is cut).
 *
 * It sits next to the `WorkingMemory` (per thread) as the memory that spans threads.
 *
 * # Who needs it
 *
 * `prepareCall` and `AIGateway.getUserFacts` read; `updateMemory` runs `isExtractDue` and `extract` in the background
 * after every answer; `AIGateway.upsertUserFact`, `removeUserFact`, `clearUserFacts` and the two built-in tools edit;
 * `forgetUser` calls `deleteByUser`. A host replaces it with its own `IUserMemoryStore` in `overrides.userMemoryStore`.
 *
 * # What needs
 *
 * `config.repository` for the facts, `llmClient` and `promptTemplateStore` (the MEMORY_USER template) for `extract`.
 *
 * # Usage
 *
 * ## When to use it
 *
 * Always, through the gateway: `createGatewayDeps` creates it from `IAIGatewayConfig.userMemoryStore`.
 *
 * ## When shouldn't use it
 *
 * A host with its own user profile store implements `IUserMemoryStore` over it and passes it in `overrides`.
 *
 * # Pitfalls
 *
 * `enabled: false` switches the extraction off only: the stored facts are still read into every prompt and still
 * editable. Every fact enters every prompt of the user: keep the caps low, and never store what the user did not state.
 */
export class UserMemoryStore implements IUserMemoryStore {
  constructor(
    private readonly config: IUserMemoryStoreConfig,
    private readonly deps: IUserMemoryStoreDeps,
  ) {
  }

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
  public async getFacts(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<IUserMemoryFact[]> {
    return this.config.repository.load({
      tenantId,
      userId,
    });
  }

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
  public async extract(
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
  ): Promise<IUserMemoryFact[]> {
    const known = await this.getFacts({
      tenantId,
      userId,
    });
    if (!this.config.enabled || !turns.length) {
      devConsole.log(EDevConsole.USER_MEMORY_STORE, "extract - skip", {
        userId,
        threadId,
        enabled: this.config.enabled,
        turns: turns.length,
        known: known.length,
      });
      return known;
    }

    const maxFacts = this.config.maxFacts ?? DEFAULT_MAX_FACTS;
    devConsole.log(EDevConsole.USER_MEMORY_STORE, "extract - extract", {
      userId,
      threadId,
      cheapModelId,
      turns: turns.length,
      known,
    });
    const rendered = await this.deps.promptTemplateStore.render({
      key: EPromptTemplateKey.MEMORY_USER,
      slots: {
        facts: known.map(fact => `${fact.key}: ${fact.value}`).join("\n") || NOTHING,
        maxFacts: String(maxFacts),
      },
    });

    let result: IModelResult;
    try {
      result = await this.deps.llmClient.complete({
        request: {
          modelId: cheapModelId,
          system: [{text: rendered.text}],
          messages: [
            {
              role: EMessageRole.USER,
              parts: [
                {
                  kind: EPartKind.TEXT,
                  text: toTranscript({turns}),
                },
              ],
            },
          ],
          outputSchema: factsSchema,
          maxOutputTokens: maxFacts * FACT_TOKENS,
        },
        meta,
      });
    }
    catch (error) {
      // The usage adapter refused the call: the facts wait for a later turn, nothing to log
      if (isUsageDeniedError(error)) return known;
      console.error(`Internal error 5372598726156: UserMemoryStore: no facts were extracted for user [${userId}] from thread [${threadId}], the model call failed`, error);
      return known;
    }

    const parsed = factsSchema.safeParse(result.structured);
    if (!parsed.success) {
      console.error(
        `Internal error 5372598726369: UserMemoryStore: no facts were extracted for user [${userId}] from thread [${threadId}], the model's answer is not the expected structure`,
        parsed.error,
      );
      return known;
    }

    devConsole.log(EDevConsole.USER_MEMORY_STORE, "extract - ops", parsed.data.facts);

    const now = new Date();
    const merged = new Map(known.map(fact => [fact.key, fact]));
    for (const extracted of parsed.data.facts) {
      const key = extracted.key.trim();
      const value = extracted.value.trim();
      if (!key) continue;
      // The user retracted the fact ("forget my language"); an unknown key changes nothing
      if (extracted.op === EUserMemoryFactOp.DELETE) {
        merged.delete(key);
        continue;
      }
      // A fact the model repeats unchanged keeps its date and its source
      if (!value || merged.get(key)?.value === value) continue;
      merged.set(key, {
        key,
        value,
        sourceThreadId: threadId,
        updatedAt: now,
      });
    }
    const stored = await this.save({
      tenantId,
      userId,
      facts: [...merged.values()],
    });
    devConsole.log(EDevConsole.USER_MEMORY_STORE, "extract - stored", stored);
    return stored;
  }

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
  public isExtractDue(
    {
      turnCount,
      previousTurnCount,
    }: {
      /** Turns of the thread now. */
      turnCount: number;
      /** Turns of the thread before the call that just ended; a call adds several turns at once. */
      previousTurnCount: number;
    },
  ): boolean {
    const every = this.config.extractEveryTurns ?? DEFAULT_EXTRACT_EVERY_TURNS;
    const due =
      this.config.enabled
      && (
        (previousTurnCount === 0 && turnCount > 0)
        || Math.floor(turnCount / every) > Math.floor(previousTurnCount / every)
      );
    devConsole.log(EDevConsole.USER_MEMORY_STORE, "isExtractDue", {
      due,
      enabled: this.config.enabled,
      turnCount,
      previousTurnCount,
      every,
    });
    return due;
  }

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
  public async upsertFact(
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
  ): Promise<void> {
    const fact: IUserMemoryFact = {
      key: key.trim(),
      value: value.trim(),
      updatedAt: new Date(),
    };
    if (!fact.key || !fact.value) {
      throw dynaError({
        code: 5372597957094,
        status: 400,
        message: "UserMemoryStore: a fact needs a key and a value",
        data: {
          tenantId,
          userId,
          key,
        },
      });
    }
    const maxFactChars = this.config.maxFactChars ?? DEFAULT_MAX_FACT_CHARS;
    const length = Math.max(fact.key.length, fact.value.length);
    if (length > maxFactChars) {
      throw dynaError({
        code: 5377210486159,
        status: 400,
        message: `UserMemoryStore: a fact's key or value is ${length} chars, over maxFactChars ${maxFactChars}`,
        userMessage: `A remembered fact can be at most ${maxFactChars} characters; please keep it shorter`,
        data: {
          key: fact.key.slice(0, maxFactChars),
          length,
          maxFactChars,
        },
      });
    }
    const facts = await this.getFacts({
      tenantId,
      userId,
    });
    await this.save({
      tenantId,
      userId,
      facts: [...facts.filter(existing => existing.key !== fact.key), fact],
    });
  }

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
  public async removeFact(
    {
      tenantId,
      userId,
      key,
    }: {
      tenantId: string;
      userId: string;
      key: string;
    },
  ): Promise<void> {
    const facts = await this.getFacts({
      tenantId,
      userId,
    });
    const kept = facts.filter(fact => fact.key !== key);
    if (kept.length === facts.length) return;
    await this.save({
      tenantId,
      userId,
      facts: kept,
    });
  }

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
  public async clear(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<void> {
    await this.save({
      tenantId,
      userId,
      facts: [],
    });
  }

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
  public async deleteByUser(
    {
      tenantId,
      userId,
    }: {
      tenantId: string;
      userId: string;
    },
  ): Promise<number> {
    return this.config.repository.deleteByUser({
      tenantId,
      userId,
    });
  }

  /**
   * Saves the facts and returns what was saved; over maxFacts the ones that were updated longest ago are dropped. A key or value
   * over maxFactChars is cut to it: the extractor's facts are written here without the check of upsertFact.
   */
  private async save(
    {
      tenantId,
      userId,
      facts,
    }: {
      tenantId: string;
      userId: string;
      facts: IUserMemoryFact[];
    },
  ): Promise<IUserMemoryFact[]> {
    const maxFacts = this.config.maxFacts ?? DEFAULT_MAX_FACTS;
    const maxFactChars = this.config.maxFactChars ?? DEFAULT_MAX_FACT_CHARS;
    const capped = facts.map(fact => fact.key.length > maxFactChars || fact.value.length > maxFactChars
      ? {
        ...fact,
        key: fact.key.slice(0, maxFactChars),
        value: fact.value.slice(0, maxFactChars),
      }
      : fact);
    const kept = capped.length > maxFacts
      ? [...capped]
        .sort((factA, factB) => factB.updatedAt.getTime() - factA.updatedAt.getTime())
        .slice(0, maxFacts)
      : capped;
    await this.config.repository.saveAll({
      tenantId,
      userId,
      facts: kept,
    });
    return kept;
  }
}
