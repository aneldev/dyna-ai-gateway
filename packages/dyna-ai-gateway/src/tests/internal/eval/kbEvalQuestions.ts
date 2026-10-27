/** A question and the chunk that should be found for it: a chunk of `docId` whose text contains `phrase`. */
export interface IKbEvalQuestion {
  question: string;
  docId: string;
  /** Words of the expected chunk's text. The chunk is named by its content, not by its id, so another chunker can be measured with the same questions. */
  phrase: string;
}

// The questions are worded as a user would ask them: they do not repeat the wording of the documents.
export const kbEvalQuestions: IKbEvalQuestion[] = [
  // Refunds
  {
    question: "How long do I have to send a book back and get my money?",
    docId: "refunds",
    phrase: "within 34 days",
  },
  {
    question: "My book arrived with pages printed upside down, is it too late after half a year?",
    docId: "refunds",
    phrase: "14 months",
  },
  {
    question: "Where do I find the return form?",
    docId: "refunds",
    phrase: "form R-12",
  },
  {
    question: "Do I get the delivery costs back when I return something?",
    docId: "refunds",
    phrase: "shipping fee of the original order",
  },
  {
    question: "I paid by credit card, how many days until the money is back on it?",
    docId: "refunds",
    phrase: "six and nine working days",
  },
  {
    question: "Can I return an e-book I already downloaded?",
    docId: "refunds",
    phrase: "E-books and audio downloads",
  },
  // Invoices
  {
    question: "What does an invoice number look like?",
    docId: "invoices",
    phrase: "NW-2026-004217",
  },
  {
    question: "The amount on an invoice we sent is wrong. Can I just change it?",
    docId: "invoices",
    phrase: "never edited",
  },
  {
    question: "Is there a discount when a company pays quickly?",
    docId: "invoices",
    phrase: "3 percent",
  },
  {
    question: "What happens when a business customer does not pay on time?",
    docId: "invoices",
    phrase: "reminder fee of 12 euros",
  },
  {
    question: "Can a customer get the invoice on paper?",
    docId: "invoices",
    phrase: "2.50 euros",
  },
  // Expenses
  {
    question: "When am I allowed to take a plane instead of the train?",
    docId: "expenses",
    phrase: "longer than five hours",
  },
  {
    question: "How much do I get for food per day on a business trip?",
    docId: "expenses",
    phrase: "38 euros",
  },
  {
    question: "What is the rate per kilometre for driving my own car?",
    docId: "expenses",
    phrase: "0.46 euros",
  },
  {
    question: "Until when can I claim an expense?",
    docId: "expenses",
    phrase: "within 75 days",
  },
  {
    question: "Who has to sign off an expensive claim?",
    docId: "expenses",
    phrase: "head of finance",
  },
  // Portal
  {
    question: "I cannot log in any more, I forgot my password. What now?",
    docId: "app",
    phrase: "Forgot password",
  },
  {
    question: "Can I get the login code by text message?",
    docId: "app",
    phrase: "authenticator app",
  },
  {
    question: "How do I download all invoices as a spreadsheet file?",
    docId: "app",
    phrase: "CSV file",
  },
  {
    question: "What is an accountant allowed to do in the portal?",
    docId: "app",
    phrase: "three roles",
  },
  {
    question: "Why was I logged out while I was on the phone?",
    docId: "app",
    phrase: "18 minutes",
  },
  // Shipping
  {
    question: "How fast is delivery to another EU country?",
    docId: "shipping",
    phrase: "five to eight working days",
  },
  {
    question: "From which amount is delivery free?",
    docId: "shipping",
    phrase: "45 euros",
  },
  {
    question: "The box was crushed when it arrived. What do I have to do?",
    docId: "shipping",
    phrase: "within three days of delivery",
  },
  // Data protection
  {
    question: "How many years are invoices stored?",
    docId: "data",
    phrase: "eleven years",
  },
  {
    question: "How often is the database backed up and how long are the copies kept?",
    docId: "data",
    phrase: "kept for 40 days",
  },
  // Other languages: the documents are English, the question is not
  {
    question: "Wie lange habe ich Zeit, ein Buch zurückzugeben?",
    docId: "refunds",
    phrase: "within 34 days",
  },
  {
    question: "Wie viel Kilometergeld bekomme ich für mein privates Auto?",
    docId: "expenses",
    phrase: "0.46 euros",
  },
  {
    question: "Πόσες μέρες χρειάζεται η παράδοση σε άλλη χώρα της ΕΕ;",
    docId: "shipping",
    phrase: "five to eight working days",
  },
  {
    question: "Πώς μπορώ να αλλάξω τον κωδικό μου αν τον ξέχασα;",
    docId: "app",
    phrase: "Forgot password",
  },
];

/**
 * Questions about the same shop that the handbook does not answer. They share words and the subject with the documents,
 * so a similarity threshold cannot keep all their chunks out: these are the cases the model has to recognise itself.
 */
export const kbEvalNearMissQuestions: string[] = [
  "What is the dividend policy of Nordwind Books for its shareholders?",
  "Who founded Nordwind Books and in which year?",
  "What are the opening hours of the Nordwind Books shop in the city centre?",
  "Does Nordwind Books offer an apprenticeship for booksellers?",
  "Which book is the bestseller of Nordwind Books this month?",
  "How can an author send a manuscript to Nordwind Books?",
];

/** Questions that have nothing to do with the handbook: the search should find nothing for them. */
export const kbEvalOffTopicQuestions: string[] = [
  "What is the capital of Australia?",
  "How do I bake sourdough bread?",
  "Who won the football world cup in 2014?",
  "Explain how a transformer neural network works.",
  "What is the best way to learn to play the guitar?",
  "How tall is Mount Everest?",
];
