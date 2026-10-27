import {makeCallSignal} from "../makeCallSignal";

/** 0, negative, a fraction, NaN, Infinity and more than Node's largest timer: each would fire at once or throw out of the timer. */
test("makeCallSignal: a timeoutMs that is not a positive integer within Node's timer range is refused with a 400", () => {
  const refused = [0, -1, 1.5, NaN, Infinity, 2 ** 31].map(timeoutMs => {
    try {
      makeCallSignal({timeoutMs});
      return "accepted";
    }
    catch (error) {
      return error instanceof Error && "status" in error && "code" in error ? [error.status, error.code] : "other error";
    }
  });
  expect(refused).toEqual(Array<[number, number]>(6).fill([400, 5376312450001]));
});
