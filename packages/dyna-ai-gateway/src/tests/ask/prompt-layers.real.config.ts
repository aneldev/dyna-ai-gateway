import {
  IAIGatewayConfig,
  InMemoryAIProfileRepository,
  InMemoryModelRegistryRepository,
  InMemoryUserMemoryRepository,
} from "../..";

import {anthropicModel} from "../internal/samples/models";
import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/** The token the profile's addendum makes the model end every answer with; the addendum test looks for it. */
export const PROMPT_LAYERS_ADDENDUM_TOKEN = "XK-7731";

/** The user-memory repository of the config, exported so a test can plant a fact before the call. */
export const promptLayersUserMemoryRepository = new InMemoryUserMemoryRepository();

/**
 * Prompt layers on Anthropic (`claude-haiku-4-5`): one test per layer of the system prompt (today, timezone, addendum,
 * instructions, context, memory) plants a token in that layer and asks for it, so a reorder of the `CHAT_MAIN` template
 * cannot silently drop a layer. The user memory is on so the memory layer exists; the addendum keeps the answers short and
 * carries its own token.
 */
export const gatewayConfigPromptLayers: IAIGatewayConfig = {
  ...gatewayConfigBase,
  modelRegistry: {repository: new InMemoryModelRegistryRepository({models: [anthropicModel]})},
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        modelId: anthropicModel.id,
        promptAddendum: `You are a test assistant. Answer with exactly the value asked for and nothing else. End every answer with ${PROMPT_LAYERS_ADDENDUM_TOKEN}.`,
      }],
    }),
  },
  userMemoryStore: {
    repository: promptLayersUserMemoryRepository,
    enabled: true,
  },
  defaultCheapModelId: anthropicModel.id,
};
