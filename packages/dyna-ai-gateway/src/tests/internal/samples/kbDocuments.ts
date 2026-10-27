import {IKbDocument} from "../../..";

/** Invented facts: the model cannot know them, so an answer that has them came from the knowledge base. */
export const nordwindReturnsDocument: IKbDocument = {
  id: "returns",
  libraryId: "shop",
  bookId: "handbook",
  title: "Returns at Nordwind Books",
  markdown: [
    "# Time limits",
    "A customer of Nordwind Books can ask for a refund within 34 days of the delivery date. A damaged book can be returned within 14 months.",
    "# How to return",
    "Returns go to the Nordwind Books warehouse in Graz. The customer pays the shipping unless the book arrived damaged.",
  ].join("\n"),
  tags: ["returns"],
  language: "en",
};
