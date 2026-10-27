import {askUserQuestionInputSchema} from "../makeAskUserQuestionTool";
import {EUserQuestionMode} from "../types";

describe("askUserQuestionInputSchema (D85)", () => {
  test("a free-text question is mode FREE_TEXT with no options", () => {
    const input = {
      title: "Delivery details",
      questions: [{
        text: "Delivery postcode or city",
        mode: EUserQuestionMode.FREE_TEXT,
      }],
    };
    expect(askUserQuestionInputSchema.parse(input)).toEqual(input);
    expect(askUserQuestionInputSchema.parse(input).questions[0].options).toBeUndefined();
  });
});
