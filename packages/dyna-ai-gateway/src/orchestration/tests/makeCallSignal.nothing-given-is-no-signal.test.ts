import {makeCallSignal} from "../makeCallSignal";

test("makeCallSignal: nothing given is no signal", () => {
  expect(makeCallSignal({})).toBeUndefined();
});
