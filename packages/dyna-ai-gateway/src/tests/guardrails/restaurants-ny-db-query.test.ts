import {queryRestaurants} from "./restaurants-ny.real.config";

/** The scenario's "database" query, the one `find_restaurants` runs: every restaurant, or only the ones of the given cuisine. */
test("returns every restaurant, or only the ones of the given cuisine (case-insensitive)", async () => {
  const all = await queryRestaurants({});
  const pizza = await queryRestaurants({cuisine: "Pizza"});
  expect([all.length, pizza.map(restaurant => restaurant.name)]).toEqual([4, ["Joe's Pizza", "Lombardi's"]]);
});
