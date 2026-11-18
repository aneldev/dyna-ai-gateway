---
sidebar_label: Stop hallucinations
description: "How to reduce LLM hallucinations in a TypeScript app, honestly: answer from retrieved documents (RAG), abstain when retrieval is weak, show the retrieved sources, check the answer against them, and verify quoted evidence in code where nothing may be invented."
keywords: [LLM hallucinations, RAG, retrieval augmented generation, grounding, citations, LLM-as-a-judge, TypeScript]
---

# How to Stop LLM Hallucinations: Grounded RAG with Citations and a Grounding Check

> Every language model can hallucinate, and no setting, prompt or library removes that. A system can make
> hallucinations rarer, make them visible, and block the ones it detects. Only where the user relies on something other
> than free text (a quote checked word for word against the source, a value from a closed set) can invented content be
> kept out by construction.

A model that does not know the answer still writes one. In a business application that is a wrong refund deadline, an
invented clause or a product feature that does not exist. This page shows the controls that work, and what each of
them does not do.

## 1. The problem

- The model answers from its training data, which does not know your policies, prices or products.
- A nearest-neighbour search returns the nearest excerpts even for a question your documents do not cover. The model then
  answers from an excerpt that is not about the question.
- A model told to answer will answer. Without a way to say "not covered", it fills the gap.
- The user cannot tell a grounded answer from an invented one.

## 2. The practice

### 2.1 Reduce: retrieve, abstain, show, check

1. **Answer from your documents.** Ingest them into the knowledge base and name the scope on every call (`kbFilters`).
   The excerpts reach the model labelled as documents, with the instruction to answer from them.
2. **Abstain when retrieval is weak.** A hit under `minScore` is not sent. With no hit left, the model is told to say that
   the knowledge base does not cover the question, and to say so clearly if it still answers from general knowledge.
   `citations` is then empty, so your code knows it without reading the text, and can hand the question to a person
   instead of showing an answer that rests on no document.
3. **Show the sources, and say what they are.** `citations` lists the ids of the excerpts the model was given, not the
   passages the answer rests on. Label them in the UI as retrieved sources, not as proof.
4. **Check the answer against the excerpts.** An output rule sends the answer and the excerpts to a judge, a short
   classification call on the profile's `cheapModelId` (its main model when it names none), which reports the claims the excerpts do not support.
5. **Block where the answer is binding.** A `WARNING` keeps the answer and flags it, which suits a help box. Where people
   act on the answer (a contract term, a refund decision), report an `ERROR`: the answer is blocked and the call ends as
   `FAILED`. Expect false positives, and give that outcome a path, such as a hand-over to a person. The answer streams
   while the model writes it and the rules run when it is complete, so a blocked answer ends its stream with
   `ANSWER_WITHDRAWN`. Where nobody may read an unchecked answer, show only the final `response`.
6. **Search the follow-up as a full question.** "And for a damaged one?" finds nothing as typed. The query rewriter turns
   it into a standalone search line from the thread's summary and facts, which the `SUMMARY_BUFFER` thread memory writes.

### 2.2 Eliminate by construction: verify quoted evidence in code

Where nothing may be invented, the user must not rely on free text. Ask for a structured answer whose evidence is quoted
word for word from the excerpts, and check each quote in code against the text of the excerpt it names: the output rules
of an `ask()` and of a fresh `run()` receive the full text of every excerpt the model was given (`evidence.chunks`). A
quote that is not in its excerpt blocks the answer, and so does a quote too short to carry a claim when your rule sets a
minimum length. No model takes part in this check, so every quote of an answer that passed the rule is in your
documents, apart from the markup the check strips; a reviewer's edited answer on a resume is not screened by the rules. The
model's own sentence next to the quotes can still be wrong, so the screen shows the quotes as the answer, or beside it.
An excerpt is Markdown, and a model tends to drop the markup when it quotes, so the check compares the text without the common inline markup:
a check that is too strict blocks faithful quotes.

### 2.3 Know the limits

- **A judge is another model.** It misses some unsupported claims and flags some valid inferences. It lowers the rate; it
  is not proof.
- **The threshold is a measurement, not a constant.** The right `minScore` depends on the embedding model, the chunking
  and your questions. Measure it (chapter 3.4) before you call a value strict.
- **A similarity cut drops relevant passages written in other words.** Hybrid search (keyword plus vector) and a
  reranker usually find more of them. Neither is built in; a retriever of your own replaces the gateway's through
  `overrides.kbRetriever` ([Add a knowledge base to the LLM: FAQ](../20-learn-the-gateway/070-knowledge-base.md#6-faq)).
- **A grounded answer can be grounded in the wrong excerpt.** Two documents that contradict each other, an outdated
  version, or hostile text inside a document all pass a grounding check. The pitfalls cover each.

## 3. In code

The samples run on your `gateway` and the caller's `userContext`. The setup they need, with a document ingested, is in the
learning path [Answer from your documents](../24-learning-paths/060-answer-from-your-documents.md).

### 3.1 Ask, abstain, show the retrieved sources

```ts
import {AIGateway, EGatewayResponseKind, IUserContext} from "dyna-ai-gateway";

declare const gateway: AIGateway;        // your gateway, with a knowledge base
declare const userContext: IUserContext; // who asks
declare function linkToDocument(docId: string): string;          // your document viewer
declare function handToSupport(question: string): Promise<void>; // your hand-over to a person

const question = "How long can a customer ask for a refund of a paid invoice?";

const result = await gateway.ask({
  userContext,
  profileId: "support",
  prompt: question,
  kbFilters: {libraryIds: ["policies"], bookIds: []},
}).response;

if (result.kind === EGatewayResponseKind.ANSWER) {
  if (result.citations.length === 0) {
    await handToSupport(question); // nothing passed minScore: the answer rests on no document
  } else {
    const retrievedSources = result.citations.map(chunkId => linkToDocument(chunkId.slice(0, chunkId.lastIndexOf("#")))); // docId#order
    console.log(result.text, retrievedSources); // label them as retrieved sources, not as proof
  }
}
```

### 3.2 The grounding check: flag in a help box, block where people act on the answer

```ts
import {EIssueSeverity, IAIGatewayConfig, IIssue, IOutputRule} from "dyna-ai-gateway";

declare const config: IAIGatewayConfig; // your configuration

const bindingProfiles = new Set(["contracts"]); // the profiles whose answers people act on

const grounding: IOutputRule = {
  name: "grounding",
  check: async ({evidence, judge}): Promise<IIssue[]> => {
    if (evidence.chunks.length === 0) return []; // no excerpts in this call: nothing to compare with
    const issues = await judge({
      instruction: [
        "Report one issue with code `ungrounded` for every claim of the answer that the knowledge-base excerpts",
        "do not support. Report nothing when every claim is supported.",
      ].join(" "),
      chunks: true,       // the excerpts the model was given
      toolResults: false,
    });
    const severity = bindingProfiles.has(evidence.profile.id) ? EIssueSeverity.ERROR : EIssueSeverity.WARNING;
    return issues.map(issue => ({...issue, severity})); // block a binding answer, flag the others
  },
};
```

### 3.3 Quoted evidence, checked in code

```ts
import {z} from "zod";

const sourcedAnswer = z.object({
  covered: z.boolean().describe("false when the excerpts do not answer the question"),
  answer: z.string().describe("the answer in one or two sentences"),
  quotes: z.array(z.object({
    chunkId: z.string().describe("the id in brackets before the excerpt"),
    text: z.string().describe("the passage that supports the answer, copied word for word from that excerpt"),
  })),
});

// The excerpts are Markdown; a quote usually comes back without the markup and with other quotation marks
const normalise = (text: string): string => text
  .replace(/[*_`#>]/g, "")
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\s+/g, " ")
  .trim();

const quotesVerbatim: IOutputRule = {
  name: "quotes_verbatim",
  check: async ({evidence}): Promise<IIssue[]> => {
    const parsed = sourcedAnswer.safeParse(evidence.output);
    if (!parsed.success) return []; // another call's answer: not this rule's shape
    const {covered, quotes} = parsed.data;
    if (covered && quotes.length === 0) {
      return [{code: "unsupported_answer", message: "An answer without a quote", severity: EIssueSeverity.ERROR}];
    }
    return quotes
      .filter(quote => {
        const chunk = evidence.chunks.find(candidate => candidate.id === quote.chunkId);
        return !chunk || !normalise(chunk.text).includes(normalise(quote.text));
      })
      .map(quote => ({code: "quote_not_in_source", message: `Not in ${quote.chunkId}: ${quote.text}`, severity: EIssueSeverity.ERROR}));
  },
};

const groundedGateway = new AIGateway({...config, guardrails: {...config.guardrails, outputRules: [grounding, quotesVerbatim]}});

const contractQuestion = "What is the notice period of the framework contract?";

const checked = await groundedGateway.ask({
  userContext,
  profileId: "contracts",
  prompt: contractQuestion,
  instructions: "Answer only from the excerpts. Set covered to false when they do not answer the question.",
  outputSchema: sourcedAnswer,
  kbFilters: {libraryIds: ["contracts"], bookIds: []},
}).response;

if (checked.kind === EGatewayResponseKind.ANSWER && checked.structured) {
  const {covered, quotes} = checked.structured; // every quote is in the excerpt it names
  if (!covered) await handToSupport(contractQuestion);
  else for (const quote of quotes) console.log(quote.chunkId, quote.text); // show the quotes as the answer's evidence
}
if (checked.kind === EGatewayResponseKind.FAILED) await handToSupport(contractQuestion); // a quote failed, the judge blocked, or another failure
```

### 3.4 Measure the threshold and the recall on your own questions

A set of questions with the document each one should find, plus questions your documents do not cover. Run it after
every change of the documents, the chunking or the embedding model.

```ts
interface IRetrievalCase {
  question: string;
  expectedDocId: string | null; // null: the documents do not cover it, nothing should pass
}

declare const cases: IRetrievalCase[]; // your questions, from real users where you can

for (const minScore of [0.55, 0.6, 0.65, 0.7]) {
  let found = 0;
  let falseHits = 0;
  for (const {question: caseQuestion, expectedDocId} of cases) {
    const answer = await gateway.ask({
      userContext,
      profileId: "support",
      prompt: caseQuestion,
      kbFilters: {libraryIds: ["policies"], bookIds: []},
      kbRetrieval: {minScore},
    }).response;
    if (answer.kind !== EGatewayResponseKind.ANSWER) continue;
    const docIds = answer.citations.map(chunkId => chunkId.slice(0, chunkId.lastIndexOf("#")));
    if (expectedDocId && docIds.includes(expectedDocId)) found++;
    if (!expectedDocId && docIds.length > 0) falseHits++;
  }
  console.log({minScore, found, falseHits}); // pick the value with the balance your use case needs
}
```

Each case costs one embedding and one model call, plus the input and output rules of the gateway it runs on, one memory
update with the default `SUMMARY_BUFFER` memory and, with `userMemoryStore.enabled`, one user-fact extraction, both on
the cheap model. Each case also stores a new thread: run it as a test user. When the right
document is missing at every threshold, the problem is recall, not the threshold: raise `k` (`kbRetrieval: {k}`), fix
the chunking, or add hybrid search.

## 4. Pitfalls

- **Reading `citations` as proof.** A citation means the excerpt was in the request. Show it as a retrieved source, and
  check the answer against it.
- **A fixed `minScore` taken as a fact.** The default 0.6 is measured for `text-embedding-3-small`. Measure yours (chapter 3.4) and set `kbRetriever.minScore`.
- **A warning where people act on the answer.** A flag on a contract answer is read too late. Block it, and route the
  `FAILED` call to a person.
- **Chunks that lose their meaning.** The splitter cuts at the Markdown headings and embeds each section with its heading
  path. A section titled "Other", or one that mixes several topics, retrieves badly. Write one topic per section, under a
  heading that names it.
- **Two versions of a policy in the index.** The grounding check accepts an answer from the outdated one. Save a changed
  document under the same id, which replaces its chunks; remove a retired one with `removeDocument`; or scope the call to
  the current book with `bookIds`.
- **Hostile text inside a document.** An excerpt that says "ignore your rules" reaches the model as a document, labelled as
  not instructions; the label is not a barrier. Control who may ingest, and limit what the model can do
  ([Prompt injection defense](090-prompt-injection-defense.md)).
- **A scope that came out empty.** `libraryIds: []` searches nothing, and the model answers without documents. Refuse or
  log a call whose scope is empty when it should not be.
- **A grounding judge without the excerpts.** `chunks: false` leaves the judge nothing to compare with.
- **A grounding check on a resumed run.** A run resumed after an approval or a question reuses the request it paused
  with; its output rules get no excerpts (`evidence.chunks` is empty). The samples above return early or block then.
  Check grounded answers on `ask()`, or before the run pauses.
- **A corpus pasted into `context`.** It is not searched, not scored and not cited, and the grounding judge does not see
  it. The one document a call is about, such as a contract to summarise, goes with the call as `context` or a file: the
  model reads it whole, with no retrieval miss ([Summarize a document](../24-learning-paths/100-summarize-a-document.md)).

## 5. Checklist

- [ ] Documents are ingested and every call names the libraries the user may read.
- [ ] An empty `citations` on a scoped call has a path: "not covered", a hand-over.
- [ ] `minScore` and `k` are measured on your own questions, and measured again after a change.
- [ ] The UI labels `citations` as retrieved sources.
- [ ] An output rule checks the answer of `ask()` and of a fresh `run()` against `evidence.chunks`: `WARNING` for help, `ERROR` where people act
      on it.
- [ ] Where nothing may be invented, the answer quotes its evidence and code checks every quote.
- [ ] Each document is in the index in one current version.
- [ ] Chats with follow-up questions have `queryRewriter.enabled` and a `SUMMARY_BUFFER` thread memory.

## 6. Go further

- [Add a knowledge base to the LLM](../20-learn-the-gateway/070-knowledge-base.md): ingestion, scope, retrieval,
  citations.
- [LLM-as-a-judge guardrails](120-llm-as-a-judge-guardrails.md): how a judge rule is written and what it costs.
- [Structured output with zod](030-structured-output-with-zod.md): the schema of the quoted answer.
- [Multi-tenant RAG](080-multi-tenant-rag.md): the scope of a call from the user's rights.
