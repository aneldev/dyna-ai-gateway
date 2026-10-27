import {dynaError} from "dyna-error";

import {
  IToolCallPart,
  IToolDef,
  IToolResultPart,
  IUsage,
  TToolCallPolicyResult,
  TTurnPart,
  EPartKind,
  EToolCallVerdict,
  DEFAULT_TOOL_DENIAL_TEXT,
} from "../../contracts";

import {
  IResumeDecision,
  EResumeAction,
} from "../human-gate";
import {
  IUsageDeniedErrorData,
  isUsageDeniedError,
} from "../usage-guard";
import {
  asDynaError,
  formatToolError,
} from "../tool-registry/formatToolError";

import {
  ILLMClientHooks,
  IMessage,
  IModelRequest,
  IModelResult,
  IPendingCall,
  IRunLimits,
  IRunOutcome,
  TMessagePart,
  EFinishReason,
  ELLMClientEventKind,
  EMessageRole,
  ERunOutcomeStatus,
} from "./types";
import {makeRejectionOutput} from "./utils/makeRejectionOutput";

/** What one tool call left behind: the call as it ran, its result part, and whether it ended the run (D86; false for a call that did not run). */
interface IToolOutcome {
  call: IToolCallPart;
  part: IToolResultPart;
  endsRun: boolean;
}

interface ILoopState {
  messages: IMessage[];
  usage: IUsage;
  traceIds: string[];
  /** Tool names executed so far in this run; on a resume, rebuilt from the stored tool results (D72). */
  executed: string[];
  /** Model calls done in this invocation. */
  steps: number;
  lastResult: IModelResult | null;
  /** The first tool call of the run that ended it (D86); the run closes after its step. */
  endedBy: IToolCallPart | null;
  /** The call's signal, when the caller gave one; checked before every model call and every tool. */
  abortSignal?: AbortSignal;
  /** The tool calls of one step run concurrently (D101). */
  parallelToolCalls: boolean;
}

/**
 * The agent loop, without a model in it: `callModel` makes one model call per step and never runs a tool.
 * Every decision is a hook — run a tool, pause for a human, narrow the tools, stop.
 * Both the LLMClient (the SDK behind `callModel`) and the test FakeLLMClient (a script behind it) run this same loop.
 *
 * - A step with tool requests: each is executed through `hooks.executeTool` (an error it throws goes back to the model
 *   as the tool's result: its `code`, `status` and `userMessage`, never its message — `formatToolError`), unless `hooks.decideToolCall` says to pause → PAUSED with that call pending, or to deny → a denied
 *   result the model reads, and the step goes on (D87).
 * - `parallelToolCalls` (D101): every call of the step is decided first, then the allowed ones run concurrently and their
 *   results are stored in request order; the pause carries every call that needs a human. Off: decide → run → next, and the
 *   pause stops at the first such call, the calls after it undecided.
 * - A step without tool requests ends the run → DONE.
 * - An executed call for which `hooks.endsRun` is true ends the run after its step (D86): the other calls of the step still run,
 *   then one final model call without tools phrases the answer → DONE with `endedByTool`.
 * - `limits.maxSteps` ends it early → DONE with finishReason LENGTH.
 * - A step after the first that the usage adapter refused (`callModel` threw the usage-denied error) ends it the same way, with
 *   `usageDenied` on the outcome; a refused first step is thrown, the run has nothing to keep.
 * - `resume`: every decision is applied to its pending tool call (by `callId`; a single decision without one goes to the first
 *   call without a result), the approved calls run as a batch, then the loop continues. A REJECT stores the composed rejection
 *   text (the pause's text for that call or the default, plus the human's reason) as the call's result.
 * - `abortSignal`: checked before every model call and every tool, and handed to both; once aborted the loop stops where it is and
 *   returns ABORTED with the steps that completed (D90): the tools that ran stay on record, an abort thrown by a tool or a model
 *   call is never a tool result, and a pause decided after the abort is not taken.
 */
export const runAgentLoop = async (
  {
    request,
    hooks,
    limits,
    parallelToolCalls = true,
    resume,
    abortSignal,
    callModel,
  }: {
    request: IModelRequest;
    hooks: ILLMClientHooks;
    limits: IRunLimits;
    /** The tool calls of one step run concurrently (D101); false runs them one after the other. */
    parallelToolCalls?: boolean;
    /** The call's signal; omitted = the run cannot be stopped from outside. */
    abortSignal?: AbortSignal;
    /** Messages of a paused run plus the human's decisions; omit for a fresh run. */
    resume?: {
      messages: IMessage[];
      /** One per pending call the human decided on; a single decision without `callId` is for the first unresolved call. */
      decisions: IResumeDecision[];
      /** The policy's text for a rejection, per `callId` (D87), as the pause carried it; a call without one gets `DEFAULT_TOOL_REJECTION_TEXT`. */
      rejectionTexts?: Record<string, string>;
    };
    /** One model call. Streams its text through `hooks.onEvent` (TEXT_DELTA) itself; must not execute tools. */
    callModel(args: {
      messages: IMessage[];
      tools: IToolDef[];
      stepIndex: number;
    }): Promise<IModelResult>;
  },
): Promise<IRunOutcome> => {
  const state: ILoopState = {
    messages: [...resume?.messages ?? request.messages],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
    },
    traceIds: [],
    executed: resume ? getExecutedToolNames(resume.messages) : [],
    steps: 0,
    lastResult: null,
    // A tool that ended the run before the pause still ends it (D86): its result is marked in the stored messages
    endedBy: resume ? findEndedBy(resume.messages) : null,
    abortSignal,
    parallelToolCalls,
  };
  const canStep = (): boolean => state.steps < limits.maxSteps;

  try {
    if (resume) {
      const pending = await applyDecisions(state, resume, hooks);
      if (pending.length > 0) return pause(state, pending, hooks);
      if (state.endedBy) return finalStep(state, state.endedBy, request, hooks, callModel, canStep);
    }

    while (canStep()) {
      abortSignal?.throwIfAborted();
      const stepIndex = state.steps;
      const tools = hooks.prepareStep({
        stepIndex,
        executed: [...state.executed],
      });
      const result = await callModel({
        messages: [...state.messages],
        tools,
        stepIndex,
      });
      recordStep(state, result);

      if (result.toolCalls.length === 0) {
        emit(hooks, ELLMClientEventKind.STEP_END, stepIndex);
        emit(hooks, ELLMClientEventKind.DONE, stepIndex);
        return finish(state, result);
      }

      const pending = await runToolCalls(state, result.toolCalls, tools, hooks, stepIndex);
      if (pending.length > 0) return pause(state, pending, hooks);
      emit(hooks, ELLMClientEventKind.STEP_END, stepIndex);
      if (state.endedBy) return finalStep(state, state.endedBy, request, hooks, callModel, canStep);
    }

    return finishStopped(state, request, hooks);
  }
  catch (error) {
    if (!abortSignal?.aborted && isUsageDeniedError(error) && state.steps > 0) return finishDenied(state, request, hooks, error.data);
    if (!abortSignal?.aborted) throw error;
    // The call was stopped: the run ends here with what it has, whatever a layer threw on the way out
    if (error !== abortSignal.reason) {
      console.error("Internal error 5376412760049: runAgentLoop: the run was aborted but a layer failed with another error", error);
    }
    return abort(state);
  }
};

/** Accounts one model call and appends its assistant message. */
const recordStep = (state: ILoopState, result: IModelResult): void => {
  state.steps++;
  state.usage.inputTokens += result.usage.inputTokens;
  state.usage.outputTokens += result.usage.outputTokens;
  state.traceIds.push(result.traceId);
  state.lastResult = result;
  state.messages.push({
    role: EMessageRole.ASSISTANT,
    parts: [
      ...result.text
        ? [{
          kind: EPartKind.TEXT as const,
          text: result.text,
        }]
        : [],
      ...result.toolCalls,
    ],
  });
};

/**
 * The step after a tool ended the run (D86): one model call with no tools, so the model phrases the answer from the tool's
 * result. An ordinary step for the limits: when they refuse it, the run stops as it would without the final text.
 * A tool call the model produces anyway (it was offered none) gets a failed result, so the transcript stays valid.
 */
const finalStep = async (
  state: ILoopState,
  endedBy: IToolCallPart,
  request: IModelRequest,
  hooks: ILLMClientHooks,
  callModel: (args: {messages: IMessage[]; tools: IToolDef[]; stepIndex: number}) => Promise<IModelResult>,
  canStep: () => boolean,
): Promise<IRunOutcome> => {
  emit(hooks, ELLMClientEventKind.RUN_ENDED_BY_TOOL, Math.max(0, state.steps - 1), {toolCall: endedBy});
  if (!canStep()) return finishStopped(state, request, hooks);
  state.abortSignal?.throwIfAborted();

  const stepIndex = state.steps;
  const result = await callModel({
    messages: [...state.messages],
    tools: [],
    stepIndex,
  });
  recordStep(state, result);
  for (const call of result.toolCalls) {
    state.messages.push({
      role: EMessageRole.TOOL,
      parts: [
        {
          kind: EPartKind.TOOL_RESULT,
          callId: call.callId,
          toolName: call.toolName,
          output: {error: `The run has ended after ${endedBy.toolName}; no tool is available in this step`},
          failed: true,
        },
      ],
    });
  }
  emit(hooks, ELLMClientEventKind.STEP_END, stepIndex);
  emit(hooks, ELLMClientEventKind.DONE, stepIndex);
  return finish(state, {
    ...result,
    toolCalls: [],
  });
};

/** Stopped by maxSteps before the model gave a final answer: DONE with finishReason LENGTH. */
const finishStopped = (state: ILoopState, request: IModelRequest, hooks: ILLMClientHooks): IRunOutcome => {
  emit(hooks, ELLMClientEventKind.DONE, Math.max(0, state.steps - 1));
  return finish(state, {
    modelId: request.modelId,
    text: state.lastResult?.text ?? "",
    toolCalls: [],
    finishReason: EFinishReason.LENGTH,
    usage: state.lastResult?.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
    },
    latencyMs: state.lastResult?.latencyMs ?? 0,
    traceId: state.lastResult?.traceId ?? "",
  });
};

/** A step after the first that the usage adapter refused: DONE with finishReason LENGTH, the refusal on the outcome. */
const finishDenied = (state: ILoopState, request: IModelRequest, hooks: ILLMClientHooks, usageDenied: IUsageDeniedErrorData): IRunOutcome => ({
  ...finishStopped(state, request, hooks),
  usageDenied,
});

const finish = (state: ILoopState, result: IModelResult): IRunOutcome => ({
  status: ERunOutcomeStatus.DONE,
  result,
  messages: state.messages,
  steps: state.steps,
  usage: state.usage,
  traceIds: state.traceIds,
  ...state.endedBy ? {endedByTool: state.endedBy.toolName} : {},
});

/** The run stopped by the call's signal: what completed so far, no result, no pending call. */
const abort = (state: ILoopState): IRunOutcome => ({
  status: ERunOutcomeStatus.ABORTED,
  messages: state.messages,
  steps: state.steps,
  usage: state.usage,
  traceIds: state.traceIds,
});

/** A pause decided after the signal fired is not taken: the caller stopped the run, nobody waits for the human. */
const pause = (state: ILoopState, pending: IPendingCall[], hooks: ILLMClientHooks): IRunOutcome => {
  if (state.abortSignal?.aborted) return abort(state);
  emit(hooks, ELLMClientEventKind.RUN_PAUSED, Math.max(0, state.steps - 1), {toolCalls: pending.map(pendingCall => pendingCall.call)});
  return {
    status: ERunOutcomeStatus.PAUSED,
    messages: state.messages,
    pendingCalls: pending,
    steps: state.steps,
    usage: state.usage,
    traceIds: state.traceIds,
  };
};

/**
 * The tool phase of a step, with `tools` the ones offered in it: returns the calls that wait for a human, in request order
 * (empty = the step is complete). Parallel (D101): every call is decided first, the allowed ones run concurrently, the
 * results land in the transcript in request order. Sequential: decide → run → next, stopping at the first call that needs
 * approval; the calls after it stay undecided and without a result. A denied call gets its result and the step goes on (D87).
 */
const runToolCalls = (state: ILoopState, calls: IToolCallPart[], tools: IToolDef[], hooks: ILLMClientHooks, stepIndex: number): Promise<IPendingCall[]> =>
  state.parallelToolCalls
    ? runToolCallsInParallel(state, calls, tools, hooks, stepIndex)
    : runToolCallsInSequence(state, calls, tools, hooks, stepIndex);

const runToolCallsInSequence = async (state: ILoopState, calls: IToolCallPart[], tools: IToolDef[], hooks: ILLMClientHooks, stepIndex: number): Promise<IPendingCall[]> => {
  for (const call of calls) {
    const decision = await decideToolCall(call, tools, hooks, stepIndex);
    if (decision.verdict === EToolCallVerdict.NEEDS_APPROVAL) return [toPendingCall(call, decision)];
    recordToolOutcome(
      state,
      decision.verdict === EToolCallVerdict.DENY
        ? denyTool(call, decision.reason, hooks, stepIndex)
        : await executeTool(state, call, tools, hooks, stepIndex),
    );
  }
  return [];
};

/**
 * Decides every call in request order, then runs the allowed ones as one batch. The calls of a tool whose `policy` is a
 * predicate are decided and run one by one after that batch, in request order: such a policy may read state the calls of
 * this step change ("deny when the charge is already refunded"), and a decision taken before an earlier call ran would let
 * the same refund through twice. The results land in the transcript in request order; an abort keeps the finished ones.
 */
const runToolCallsInParallel = async (state: ILoopState, calls: IToolCallPart[], tools: IToolDef[], hooks: ILLMClientHooks, stepIndex: number): Promise<IPendingCall[]> => {
  const inOrder = calls.filter(call => hasPredicatePolicy(call, tools));
  const upFront = calls.filter(call => !inOrder.includes(call));
  const decisions = new Map<string, TToolCallPolicyResult>();
  for (const call of upFront) decisions.set(call.callId, await decideToolCall(call, tools, hooks, stepIndex));

  const outcomes = new Map<string, IToolOutcome>();
  let cut: {reason: unknown} | undefined;
  const settled = await Promise.allSettled(upFront.map(call => runDecidedCall(state, call, decisions.get(call.callId), tools, hooks, stepIndex)));
  settled.forEach((outcome, index) => {
    const call = upFront[index];
    if (outcome.status === "rejected") cut ??= {reason: outcome.reason};
    else if (outcome.value && call) outcomes.set(call.callId, outcome.value);
  });
  for (const call of cut ? [] : inOrder) {
    try {
      const decision = await decideToolCall(call, tools, hooks, stepIndex);
      decisions.set(call.callId, decision);
      const outcome = await runDecidedCall(state, call, decision, tools, hooks, stepIndex);
      if (outcome) outcomes.set(call.callId, outcome);
    }
    catch (error) {
      cut = {reason: error};
      break;
    }
  }
  calls.forEach(call => {
    const outcome = outcomes.get(call.callId);
    if (outcome) recordToolOutcome(state, outcome);
  });
  if (cut) throw cut.reason;

  return calls.flatMap(call => {
    const decision = decisions.get(call.callId);
    return decision?.verdict === EToolCallVerdict.NEEDS_APPROVAL ? [toPendingCall(call, decision)] : [];
  });
};

/** The outcome of a decided call: the denied result, the executed result, or none for a call that waits for a human. */
const runDecidedCall = async (
  state: ILoopState,
  call: IToolCallPart,
  decision: TToolCallPolicyResult | undefined,
  tools: IToolDef[],
  hooks: ILLMClientHooks,
  stepIndex: number,
): Promise<IToolOutcome | undefined> => {
  if (!decision || decision.verdict === EToolCallVerdict.NEEDS_APPROVAL) return undefined;
  if (decision.verdict === EToolCallVerdict.DENY) return denyTool(call, decision.reason, hooks, stepIndex);
  return executeTool(state, call, tools, hooks, stepIndex);
};

/** True for a call of a tool of this step whose `policy` is a predicate: it decides per call and may read changing state. */
const hasPredicatePolicy = (call: IToolCallPart, tools: IToolDef[]): boolean =>
  typeof tools.find(tool => tool.name === call.toolName)?.policy === "function";

/**
 * Runs the tasks — all at once on a parallel run (D101), one after the other otherwise — and records their outcomes in request
 * order. A parallel batch is awaited to the end, so the finished calls keep their results when one is cut by the abort (D90):
 * the fulfilled outcomes are recorded, then the first rejection (the abort) is rethrown.
 */
const runBatch = async (state: ILoopState, tasks: Array<() => Promise<IToolOutcome>>): Promise<void> => {
  if (!state.parallelToolCalls) {
    for (const task of tasks) recordToolOutcome(state, await task());
    return;
  }
  const settled = await Promise.allSettled(tasks.map(task => task()));
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") recordToolOutcome(state, outcome.value);
  }
  const cut = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (cut) throw cut.reason;
};

/** Announces the call and asks the policy. Only a tool of this step is decided on: a hidden one goes straight to the refusal of `executeTool` (D79). */
const decideToolCall = async (call: IToolCallPart, tools: IToolDef[], hooks: ILLMClientHooks, stepIndex: number): Promise<TToolCallPolicyResult> => {
  emit(hooks, ELLMClientEventKind.TOOL_REQUEST, stepIndex, {toolCall: call});
  const offered = tools.some(tool => tool.name === call.toolName);
  return offered ? hooks.decideToolCall({call}) : {verdict: EToolCallVerdict.ALLOW};
};

const toPendingCall = (call: IToolCallPart, decision: Extract<TToolCallPolicyResult, {verdict: EToolCallVerdict.NEEDS_APPROVAL}>): IPendingCall => ({
  call,
  ...decision.rejectionText === undefined ? {} : {rejectionText: decision.rejectionText},
  ...decision.reasonCode === undefined ? {} : {reasonCode: decision.reasonCode},
});

/**
 * Appends a call's result to the transcript and books it: a call that ran counts as executed (D72), and the first call of the
 * run that ended it is kept (D86). Called in request order, so the transcript and `endedBy` are the same for any completion order.
 */
const recordToolOutcome = (
  state: ILoopState,
  {
    call,
    part,
    endsRun,
  }: IToolOutcome,
): void => {
  const endsThisRun = endsRun && !state.endedBy;
  state.messages.push({
    role: EMessageRole.TOOL,
    parts: [endsThisRun ? {
      ...part,
      endedRun: true,
    } : part],
  });
  if (isExecutedResult(part)) state.executed.push(part.toolName);
  if (endsThisRun) state.endedBy = call;
};

/** The denied result of a call the policy refused: the fixed lead plus the reason, so the model reads it did not run (D87). */
const denyTool = (call: IToolCallPart, reason: string, hooks: ILLMClientHooks, stepIndex: number): IToolOutcome => {
  const output = `${DEFAULT_TOOL_DENIAL_TEXT} Reason: ${reason}`;
  emit(hooks, ELLMClientEventKind.TOOL_RESULT, stepIndex, {
    toolCall: call,
    toolOutput: output,
  });
  return {
    call,
    part: {
      kind: EPartKind.TOOL_RESULT,
      callId: call.callId,
      toolName: call.toolName,
      output,
      denied: true,
    },
    endsRun: false,
  };
};

/**
 * Executes one call and returns its result. An error the tool throws becomes the result, so the model can react to it; the
 * abort is rethrown. `endsRun` is asked for every call that ran (D86); `recordToolOutcome` keeps the first in request order.
 */
const executeTool = async (state: ILoopState, call: IToolCallPart, tools: IToolDef[], hooks: ILLMClientHooks, stepIndex: number): Promise<IToolOutcome> => {
  let output: unknown;
  let failed = false;
  let endsRun = false;
  let errorCode: number | undefined;
  state.abortSignal?.throwIfAborted();
  try {
    output = await hooks.executeTool({
      call,
      tools,
      stepIndex,
      ...state.abortSignal ? {abortSignal: state.abortSignal} : {},
    });
  }
  catch (error) {
    // The call was stopped: not a tool failure the model should read, the run ends here
    if (state.abortSignal?.aborted) throw error;
    // A tool that did not run unlocks nothing (D76): the result says so, and `executed` leaves it out.
    // The model reads the safe fields only (code, status, userMessage); the message stays with the developer
    output = {error: formatToolError(error)};
    errorCode = asDynaError(error)?.code;
    failed = true;
  }
  if (!failed) endsRun = await askEndsRun(state, call, output, tools, hooks);
  emit(hooks, ELLMClientEventKind.TOOL_RESULT, stepIndex, {
    toolCall: call,
    toolOutput: output,
  });
  return {
    call,
    part: {
      kind: EPartKind.TOOL_RESULT,
      callId: call.callId,
      toolName: call.toolName,
      output,
      ...failed ? {failed: true} : {},
      ...errorCode === undefined ? {} : {errorCode},
    },
    endsRun,
  };
};

/**
 * Asks the tool's `endsRun` about a call that ran. A predicate that throws counts as "no": the call succeeded, and reading it as
 * a failure would tell the model to retry a side effect that already happened. The abort is rethrown.
 */
const askEndsRun = async (state: ILoopState, call: IToolCallPart, output: unknown, tools: IToolDef[], hooks: ILLMClientHooks): Promise<boolean> => {
  try {
    return await hooks.endsRun({
      call,
      output,
      tools,
    });
  }
  catch (error) {
    if (state.abortSignal?.aborted) throw error;
    console.error(`Internal error 5377210486163: runAgentLoop: the endsRun of tool [${call.toolName}] threw; the run goes on`, error);
    return false;
  }
};

/** The call whose result ended the run (`endedRun`), from a paused run's messages; null when none did. */
const findEndedBy = (messages: IMessage[]): IToolCallPart | null => {
  const parts = messages.flatMap(message => message.parts);
  const ended = parts.find((part): part is IToolResultPart => part.kind === EPartKind.TOOL_RESULT && part.endedRun === true);
  if (!ended) return null;
  return parts.find((part): part is IToolCallPart => part.kind === EPartKind.TOOL_CALL && part.callId === ended.callId) ?? null;
};

/** A result of a call that ran: neither rejected, denied nor failed (D72, D76). */
const isExecutedResult = (part: IToolResultPart): boolean => !part.rejected && !part.denied && !part.failed;

/** The tools that ran in the conversation. What ran before a pause, for `requires` (D72, D76). */
const getExecutedToolNames = (messages: IMessage[]): string[] =>
  messages.flatMap(message => message.parts.flatMap(part => part.kind === EPartKind.TOOL_RESULT && isExecutedResult(part) ? [part.toolName] : []));

/** The tool calls that have no result yet, in order; on the loop's messages and on the thread's stored turns alike. */
export const getUnresolvedToolCalls = (messages: Array<{parts: Array<TMessagePart | TTurnPart>}>): IToolCallPart[] => {
  const resolved = new Set(
    messages.flatMap(message => message.parts.flatMap(part => part.kind === EPartKind.TOOL_RESULT ? [part.callId] : [])),
  );
  return messages
    .flatMap(message => message.parts.filter((part): part is IToolCallPart => part.kind === EPartKind.TOOL_CALL))
    .filter(call => !resolved.has(call.callId));
};

/**
 * Applies the human's decisions to the unresolved tool calls, then handles the calls still undecided as usual (a sequential
 * pause leaves the later calls so). Returns the calls that need approval next (empty = none). A decision names its call by
 * `callId`; a single decision may omit it and goes to the first unresolved call. REJECT stores the composed rejection text
 * (D87), ANSWER (a userQuestions, D62) the answers; APPROVE and EDIT run the call (EDIT after the policy decided on the
 * edited input: a DENY gives the denied result), as one batch (D101), with the tools visible
 * now: what ran before the pause counts (D72). The results land in request order.
 */
const applyDecisions = async (
  state: ILoopState,
  {
    decisions,
    rejectionTexts,
  }: {decisions: IResumeDecision[]; rejectionTexts?: Record<string, string>},
  hooks: ILLMClientHooks,
): Promise<IPendingCall[]> => {
  const unresolved = getUnresolvedToolCalls(state.messages);
  const tools = hooks.prepareStep({
    stepIndex: 0,
    executed: [...state.executed],
  });
  if (unresolved.length === 0) {
    throw dynaError({
      code: 5372579127639,
      status: 409,
      message: "runAgentLoop: resume needs a pending tool call, but every tool call of the run has a result",
      data: {actions: decisions.map(decision => decision.action)},
    });
  }
  const decided = matchDecisions(unresolved, decisions);

  await runBatch(state, unresolved.flatMap((call): Array<() => Promise<IToolOutcome>> => {
    const decision = decided.get(call.callId);
    if (!decision) return [];
    if (decision.action === EResumeAction.ANSWER) {
      return [async (): Promise<IToolOutcome> => ({
        call,
        part: {
          kind: EPartKind.TOOL_RESULT,
          callId: call.callId,
          toolName: call.toolName,
          output: {answers: decision.answers ?? []},
        },
        endsRun: false,
      })];
    }
    if (decision.action === EResumeAction.REJECT) {
      return [async (): Promise<IToolOutcome> => ({
        call,
        part: {
          kind: EPartKind.TOOL_RESULT,
          callId: call.callId,
          toolName: call.toolName,
          output: makeRejectionOutput({
            rejectionText: rejectionTexts?.[call.callId],
            reason: decision.text,
          }),
          rejected: true,
        },
        endsRun: false,
      })];
    }
    if (decision.action === EResumeAction.EDIT) {
      const edited: IToolCallPart = {
        ...call,
        input: decision.editedInput,
      };
      return [(): Promise<IToolOutcome> => runEditedCall(state, edited, tools, hooks)];
    }
    return [(): Promise<IToolOutcome> => executeTool(state, call, tools, hooks, 0)];
  }));

  return runToolCalls(state, unresolved.filter(call => !decided.has(call.callId)), tools, hooks, 0);
};

/**
 * An EDIT runs the edited input through the policy again: the human approved this input, not one the policy refuses. DENY gives
 * the denied result; NEEDS_APPROVAL runs it (the human just approved it, and a tool in the profile's `approvals` always asks);
 * ALLOW runs it. A tool the step does not offer goes straight to the refusal of `executeTool` (D79).
 */
const runEditedCall = async (state: ILoopState, edited: IToolCallPart, tools: IToolDef[], hooks: ILLMClientHooks): Promise<IToolOutcome> => {
  const offered = tools.some(tool => tool.name === edited.toolName);
  const decision: TToolCallPolicyResult = offered ? await hooks.decideToolCall({call: edited}) : {verdict: EToolCallVerdict.ALLOW};
  return decision.verdict === EToolCallVerdict.DENY
    ? denyTool(edited, decision.reason, hooks, 0)
    : executeTool(state, edited, tools, hooks, 0);
};

/**
 * Pairs every decision with its unresolved call, by `callId`. A single decision without one takes the first unresolved call.
 * A decision for a call that is not pending, or a second decision for the same call, is a 400.
 */
const matchDecisions = (unresolved: IToolCallPart[], decisions: IResumeDecision[]): Map<string, IResumeDecision> => {
  const matched = new Map<string, IResumeDecision>();
  for (const decision of decisions) {
    const callId = decision.callId ?? (decisions.length === 1 ? unresolved[0]?.callId : undefined);
    if (callId === undefined || !unresolved.some(call => call.callId === callId)) {
      throw dynaError({
        code: 5376612345013,
        status: 400,
        message: decision.callId === undefined
          ? "runAgentLoop: a decision needs a callId when the run has several pending tool calls"
          : `runAgentLoop: the decision names no pending tool call: [${decision.callId}]`,
        data: {
          callId: decision.callId,
          pending: unresolved.map(call => call.callId),
        },
      });
    }
    if (matched.has(callId)) {
      throw dynaError({
        code: 5376612345025,
        status: 400,
        message: `runAgentLoop: two decisions for the tool call [${callId}]`,
        data: {callId},
      });
    }
    matched.set(callId, decision);
  }
  return matched;
};

const emit = (
  hooks: ILLMClientHooks,
  kind: ELLMClientEventKind,
  stepIndex: number,
  details: {toolCall?: IToolCallPart; toolCalls?: IToolCallPart[]; toolOutput?: unknown} = {},
): void => {
  hooks.onEvent({
    event: {
      kind,
      stepIndex,
      ...details,
    },
  });
};
