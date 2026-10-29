import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
} from "../..";

import {anthropicModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the addendum makes the model end every answer with; the test checks the model read the (cached) addendum. */
export const PROMPT_CACHING_TOKEN = "QC-4096";

/** Number of numbered rules in the operating manual; 160 rules of about 32 tokens pass the 4096-token minimum of `claude-haiku-4-5` with margin. */
const MANUAL_RULES = 160;

/**
 * A long "operating manual" addendum: Anthropic caches a prefix only from the model's minimum on (4096 tokens on
 * `claude-haiku-4-5`), so the stable block of this profile has to be that long. The rules are distinct sentences so the
 * tokenizer does not compress them.
 */
const buildOperatingManual = (): string => {
  const departments = ["billing", "shipping", "returns", "warranty", "accounts", "loyalty", "privacy", "escalations"];
  const rules = Array.from({length: MANUAL_RULES}, (_, index) => {
    const number = index + 1;
    const department = departments[index % departments.length];
    return `Rule ${number} (${department}): when a customer raises a ${department} question of category ${number}, verify the order reference first, quote policy clause ${department}-${number}, and offer the standard ${department} remedy before anything else.`;
  });
  return [
    "You are the support assistant of the Nordwind web shop. Answer with exactly the value asked for and nothing else.",
    `End every answer with ${PROMPT_CACHING_TOKEN}.`,
    "",
    "Operating manual:",
    ...rules,
  ].join("\n");
};

/**
 * Prompt caching on Anthropic (`claude-haiku-4-5`): the profile's addendum is a long operating manual, so the stable block
 * of the system prompt passes the model's cacheable minimum; prompt caching is on in `gatewayConfigBase`. Three calls on
 * one thread let the test see the cache write on the first call and the cache reads on the next two.
 */
export const gatewayConfigPromptCaching: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [anthropicModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        modelId: anthropicModel.id,
        promptAddendum: buildOperatingManual(),
      }],
    }),
  },
  defaultCheapModelId: anthropicModel.id,
};
