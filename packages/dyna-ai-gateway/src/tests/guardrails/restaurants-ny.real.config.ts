import {z} from "zod";

import {
  IAIGatewayConfig,
  IIssue,
  IInputRule,
  InMemoryAIProfileRepository,
  defineTool,
} from "../..";

import {sampleProfile} from "../internal/samples/profiles";
import {gatewayConfigBase} from "../internal/utils/gatewayConfigBase";

/**
 * Scenario "restaurants of New York": the user may ask about restaurants in New York City, nothing elsewhere.
 * A judge rule (a model call on the cheap model) rejects questions about any other place; a read-only tool answers from a small
 * in-memory "database". Tests: `restaurants-ny-*.test.ts`.
 */

export interface IRestaurant {
  name: string;
  neighborhood: string;
  cuisine: string;
}

/** The "database": the restaurants of New York. */
export const restaurantsDb: IRestaurant[] = [
  {
    name: "Katz's Delicatessen",
    neighborhood: "Lower East Side",
    cuisine: "deli",
  },
  {
    name: "Joe's Pizza",
    neighborhood: "Greenwich Village",
    cuisine: "pizza",
  },
  {
    name: "Lombardi's",
    neighborhood: "Little Italy",
    cuisine: "pizza",
  },
  {
    name: "Peter Luger Steak House",
    neighborhood: "Williamsburg",
    cuisine: "steakhouse",
  },
];

/** The DB query: the restaurants of New York, narrowed by cuisine when one is given (case-insensitive). */
export const queryRestaurants = ({cuisine}: {cuisine?: string}): Promise<IRestaurant[]> => Promise.resolve(
  restaurantsDb.filter(restaurant => !cuisine || restaurant.cuisine === cuisine.toLowerCase()),
);

/** Read only: the model calls it without approval. Returns the restaurants as objects, so the model can list or tabulate them. */
export const findRestaurantsTool = defineTool({
  name: "find_restaurants",
  description: "Finds restaurants in New York City. Call it whenever the user asks where to eat in New York.",
  inputSchema: z.object({
    cuisine: z.string().optional()
      .describe("Kind of food, e.g. pizza; omit for all"),
  }),
  tags: ["restaurants"],
  execute: ({input}): Promise<IRestaurant[]> => queryRestaurants(input),
});

/** Scope rule: a judge (the profile's cheap model) decides whether the question stays inside New York. */
export const restaurantScopeRule: IInputRule = {
  name: "restaurant_scope",
  check: ({judge}): Promise<IIssue[]> => judge({
    instruction: [
      "This assistant answers only questions about restaurants in New York City, USA.",
      "Report one issue with code `out_of_scope` and severity `error` when the prompt asks about restaurants, food or dining",
      "in any other city or country.",
      "A prompt about New York, or one that names no place at all, passes: report no issues.",
    ].join(" "),
    fileFilter: () => false,
  }),
};

export const gatewayConfigRestaurantsNy: IAIGatewayConfig = {
  ...gatewayConfigBase,
  aiProfileStore: {
    repository: new InMemoryAIProfileRepository({
      profiles: [{
        ...sampleProfile,
        promptAddendum: "You recommend restaurants in New York City. Use the find_restaurants tool for every recommendation and answer in English.",
        allowedTools: [findRestaurantsTool.name],
      }],
    }),
  },
  toolRegistry: {tools: [findRestaurantsTool]},
  guardrails: {inputRules: [restaurantScopeRule]},
};
