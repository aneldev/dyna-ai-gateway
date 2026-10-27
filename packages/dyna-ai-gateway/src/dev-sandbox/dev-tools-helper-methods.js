/*
 Paste this whole file into the dev-tools console of a `./sandbox.debug.sh` session (plain JavaScript, not loaded by
 sandbox.debug.ts). It defines globals over `dynaEnv` that remember the last response, so each call continues the last
 thread or pause. Every helper returns the `TGatewayResponse` and runs with `debug: true`.

 # Usage examples (the refund scenario)

 await start("Refund 101");           // → paused: r.envelopes[0].toolCall.toolName === "refund"
 await resumeWithAction("APPROVE");   // → answer
 await resumeWithAction("EDIT", {editedInput: {amount: 50}});
 await resumeWithAction("REJECT", {text: "Not eligible"});
 await reply("And 50 more");          // → runs directly, the predicate says no
 await start("Send the overdue invoice"); // → paused: r.envelopes[0].kind === "USER_QUESTION"
 await resumeWithAnswers("4522");     // one string per question: an option name is picked, other text is typed
 useProfile("anthropic");             // every call from now on passes profileId: "anthropic" (a resume swaps the model mid-run)
 useProfile();                        // back to the config's profile (dynaEnv.profileId); a resume keeps the run's profile again
 lastResponse;                            // the last TGatewayResponse
*/

const dynaEnv = global.dynaEnv;

let lastResponse = null;
/** The profile chosen with useProfile(); undefined = the config's profile (dynaEnv.profileId) for a call, the run's own for a resume. */
let chosenProfileId = undefined;

Object.defineProperty(global, "lastResponse", {
  get: () => lastResponse,
  configurable: true,
});

/** The profile every following call runs on (`profileId`); without an argument, back to the config's profile (dynaEnv.profileId). */
global.useProfile = (id = undefined) => {
  chosenProfileId = id;
  return chosenProfileId ?? `${dynaEnv.profileId} (the config's)`;
};

/** `profileId` of a new call: the chosen one, else the config's — a call always names its profile (D103). */
const withProfile = () => ({profileId: chosenProfileId ?? dynaEnv.profileId});

/** `profileId` of a resume, only when one is chosen: without it the run keeps the profile it started with (D65). */
const withResumeProfile = () => (chosenProfileId ? {profileId: chosenProfileId} : {});

/**
 * The first envelope of the last response, or throws when the last response was not a pause.
 * The helpers answer one card; a pause of several cards (a parallel step) needs `aiGateway.resume` with every decision.
 */
const lastEnvelope = () => {
  if (!lastResponse || lastResponse.kind !== "PAUSED") {
    throw new Error(`dev-tools: the last response is ${lastResponse ? `[${lastResponse.kind}]` : "missing"}, not a pause`);
  }
  return lastResponse.envelopes[0];
};

/** The decision as `resume` takes it: named by the envelope's `callId`, when the envelope has one. */
const decisionsFor = (envelope, decision) => [envelope.callId === undefined ? decision : {...decision, callId: envelope.callId}];

/** Runs the call, remembers its response, returns it. */
const remember = async (call) => {
  lastResponse = await call.response;
  return lastResponse;
};

/** `run()` on a new thread. */
global.start = (prompt) => remember(dynaEnv.aiGateway.run({
  userContext: dynaEnv.userContext,
  kbFilters: dynaEnv.kbFilters,
  prompt,
  debug: true,
  ...withProfile(),
}));

/** `run()` on the thread of the last response. */
global.reply = (prompt) => {
  if (!lastResponse?.threadId) throw new Error("dev-tools: no last response with a thread; call start() first");
  return remember(dynaEnv.aiGateway.run({
    threadId: lastResponse.threadId,
    userContext: dynaEnv.userContext,
    kbFilters: dynaEnv.kbFilters,
    prompt,
    debug: true,
    ...withProfile(),
  }));
};

/** `resume()` the last tool-approval pause: "APPROVE", "EDIT" ({editedInput}) or "REJECT" ({text}). */
global.resumeWithAction = (action, extra = {}) => {
  const envelope = lastEnvelope();
  return remember(dynaEnv.aiGateway.resume({
    userContext: dynaEnv.userContext,
    runId: envelope.runId,
    pauseId: envelope.pauseId,
    decisions: decisionsFor(envelope, {
      action,
      ...extra,
    }),
    debug: true,
    ...withResumeProfile(),
  }));
};

/**
 * `resume()` the last user-question pause with one string per question, in the order of the questions: a string that
 * names one of the question's options is picked (`selected`), any other string is typed (`freeText`).
 */
global.resumeWithAnswers = (...texts) => {
  const envelope = lastEnvelope();
  if (envelope.kind !== "USER_QUESTION") throw new Error(`dev-tools: the last pause is [${envelope.kind}], not a user question`);
  const answers =
    envelope
      .userQuestions
      .questions
      .map((question, index) => {
        const text = texts[index] ?? "";
        const isOption = (question.options ?? []).includes(text);
        return {
          question: question.text,
          selected: isOption ? [text] : [],
          ...isOption || !text ? {} : {freeText: text},
        };
      });
  return remember(dynaEnv.aiGateway.resume({
    userContext: dynaEnv.userContext,
    runId: envelope.runId,
    pauseId: envelope.pauseId,
    decisions: decisionsFor(envelope, {
      action: "ANSWER",
      answers,
    }),
    debug: true,
    ...withResumeProfile(),
  }));
};
