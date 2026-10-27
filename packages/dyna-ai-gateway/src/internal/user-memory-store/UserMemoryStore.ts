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

/** Cross-thread user facts, extracted by a cheap LLM, editable by the user. */
export class UserMemoryStore implements IUserMemoryStore {
  constructor(
    private readonly config: IUserMemoryStoreConfig,
    private readonly deps: IUserMemoryStoreDeps,
  ) {
  }

  /** Returns all facts; injected into the system prompt. No LLM. */
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
   * Extracts durable facts from turns and merges them into the stored ones (same key = replace). Cheap LLM.
   * Returns the facts that are stored afterwards. They stay as they are when the extraction is switched off, when there
   * is no turn, when the model call fails or when its answer is not the expected structure.
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
          system: rendered.text,
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
   * Tells the gateway whether extraction is due: after the first answer of a thread (the opening message carries most facts:
   * name, place, language), and then whenever the thread crossed a multiple of extractEveryTurns with its last call.
   * Never due while the extraction is switched off.
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

  /** User or admin sets a fact by hand. Same key = replace. Throws a 400 for an empty key or value, or one over `maxFactChars`. */
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

  /** User deletes one fact. A key that is not there changes nothing. */
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

  /** User deletes everything. */
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

  /** Removes the facts of a user and their record (GDPR erasure); `clear` is the user's own "forget my facts". Returns the number of facts removed. */
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
