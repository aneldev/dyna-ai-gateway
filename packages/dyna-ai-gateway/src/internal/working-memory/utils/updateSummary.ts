import {z} from "zod";

import {
  ITurn,
  EPartKind,
} from "../../../contracts";

import {
  ILLMClientCallMeta,
  IModelResult,
  EMessageRole,
} from "../../llm-client";
import {EPromptTemplateKey} from "../../prompt-template-store";
import {toTranscript} from "../../turn-builder";
import {isUsageDeniedError} from "../../usage-guard";

import {
  IWorkingMemoryDeps,
  IWorkingMemoryState,
  IWorkingMemorySummaryBuffer,
} from "../types";

/** Room of one fact in the answer, for the output limit of the call. */
const FACT_CHARS = 100;
/** A cautious ratio for the output limit: languages with non-latin letters need more tokens per character. */
const CHARS_PER_OUTPUT_TOKEN = 2;
const NOTHING = "(nothing yet)";

/** What the model returns. Facts are a list, not a record: providers with strict structured output do not accept open-ended objects. */
const memorySchema = z.object({
  summary: z.string(),
  facts: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })),
});

/**
 * Recomputes summary + facts from `current` and `newTurns` with the cheap model, stores and returns the new state.
 * `current` is returned untouched when there is no new turn, when the model call fails (a refusal of the usage adapter
 * is silent, anything else is reported) or when its answer is not the expected structure.
 */
export const updateSummary = async (
  {
    deps,
    options,
    tenantId,
    threadId,
    current,
    newTurns,
    upToTurn,
    cheapModelId,
    meta,
  }: {
    deps: IWorkingMemoryDeps;
    options: Pick<Required<IWorkingMemorySummaryBuffer>, "maxSummaryChars" | "maxFacts">;
    tenantId: string;
    threadId: string;
    current: IWorkingMemoryState;
    /** The turns appended since the last update, oldest first. */
    newTurns: ITurn[];
    /** The thread's turnCount the new turns end at; the state's updatedAtTurn becomes it. */
    upToTurn: number;
    cheapModelId: string;
    meta: ILLMClientCallMeta;
  },
): Promise<IWorkingMemoryState> => {
  if (!newTurns.length) return current;

  const {
    maxSummaryChars,
    maxFacts,
  } = options;
  const rendered = await deps.promptTemplateStore.render({
    key: EPromptTemplateKey.MEMORY_WORKING,
    slots: {
      summary: current.summary || NOTHING,
      facts: listFacts(current.facts) || NOTHING,
      maxSummaryChars: String(maxSummaryChars),
      maxFacts: String(maxFacts),
    },
  });

  let result: IModelResult;
  try {
    result = await deps.llmClient.complete({
      request: {
        modelId: cheapModelId,
        system: [{text: rendered.text}],
        messages: [
          {
            role: EMessageRole.USER,
            parts: [
              {
                kind: EPartKind.TEXT,
                text: toTranscript({turns: newTurns}),
              },
            ],
          },
        ],
        outputSchema: memorySchema,
        maxOutputTokens: Math.ceil((maxSummaryChars + maxFacts * FACT_CHARS) / CHARS_PER_OUTPUT_TOKEN),
      },
      meta,
    });
  }
  catch (error) {
    // The usage adapter refused the call: the memory waits for a later turn, nothing to log
    if (isUsageDeniedError(error)) return current;
    console.error(`Internal error 53725977158851: WorkingMemory: the memory of thread [${threadId}] was not updated, the model call failed`, error);
    return current;
  }

  const parsed = memorySchema.safeParse(result.structured);
  if (!parsed.success) {
    console.error(`Internal error 53725977158852: WorkingMemory: the memory of thread [${threadId}] was not updated, the model's answer is not the expected structure`, parsed.error);
    return current;
  }

  const state: IWorkingMemoryState = {
    summary: parsed.data.summary.trim().slice(0, maxSummaryChars),
    facts: Object.fromEntries(
      parsed.data.facts
        .map(({
          key,
          value,
        }): [string, string] => [key.trim(), value.trim()])
        .filter(([key, value]) => key && value)
        .slice(0, maxFacts),
    ),
    updatedAtTurn: upToTurn,
  };
  await deps.threadStore.setWorkingMemory({
    tenantId,
    threadId,
    state,
  });
  return state;
};

const listFacts = (facts: IWorkingMemoryState["facts"]): string =>
  Object.entries(facts)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
